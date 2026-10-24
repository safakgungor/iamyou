/**
 * `GET /api/family` and `POST /api/family` — family mode. (Req 9, 10)
 *
 * A relative named in the profile's `digital_will.family_mode_access` asks how
 * the person would answer a question, and gets an answer grounded only in the
 * person's own vault entries, with the entries it used, or "I don't know how
 * {first_name} would answer that." Claude is reached only through
 * `claude.familyAnswer`, the server-only `familyAnswer` in `lib/claude`. (Req 9.7)
 *
 * The handlers are thin: they resolve the caller, validate the body, wire the
 * production collaborators and delegate to `getFamilyAskers` and
 * `answerFamilyQuestion`, which unit tests run with `InMemoryVaultRepository`
 * and a mocked Claude.
 *
 * Access control note: family mode runs inside the person's own session, under
 * RLS. The asker check matches the names the person chose; it does not
 * authenticate the relative.
 *
 * Requirements: 9.1–9.5, 9.7, 10.2, 10.3, 10.5, 10.6.
 */

import { NextResponse } from 'next/server';

import {
  FamilyAskersResponseSchema,
  FamilyRequestSchema,
  FamilyResponseSchema,
  type FamilyAskersResponse,
  type FamilyRequest,
  type FamilyResponse,
} from '@/lib/api-schemas';
import { familyAnswer as defaultFamilyAnswer } from '@/lib/claude';
import {
  SupabaseVaultRepository,
  type Profile,
  type VaultEntry,
  type VaultRepository,
} from '@/lib/db/vault-repository';
import { createSupabaseServerClient } from '@/lib/db/supabase-server';
import {
  dontKnowAnswer,
  familyModeAccess,
  isAllowedAsker,
  selectFamilyEntries,
  validateFamilyAnswer,
  type FamilyAnswer,
} from '@/lib/family';

/** The Claude collaborator, narrowed to the one function family mode calls. */
export interface FamilyClaude {
  familyAnswer(input: {
    firstName: string | null;
    question: string;
    entries: VaultEntry[];
  }): Promise<FamilyAnswer>;
}

export type FamilyAskersOutcome =
  | { status: 404; body: { error: string } }
  | { status: 200; body: FamilyAskersResponse };

export type FamilyOutcome =
  | { status: 404; body: { error: string } }
  | { status: 403; body: { error: 'not_in_family_mode_access' } }
  | { status: 200; body: FamilyResponse };

/** "Synthetic data" unless the profile is explicitly not synthetic. (Rule 5) */
function syntheticLabel(profile: Profile): 'Synthetic data' | null {
  return profile.synthetic === false ? null : 'Synthetic data';
}

/** Who may ask, for the screen's "who is asking". (Req 9.1) */
export async function getFamilyAskers(
  vault: Pick<VaultRepository, 'getProfile'>,
  userId: string,
): Promise<FamilyAskersOutcome> {
  const profile = await vault.getProfile(userId);
  if (!profile) {
    return { status: 404, body: { error: 'Profile not found' } };
  }
  return {
    status: 200,
    body: {
      first_name: profile.firstName,
      askers: familyModeAccess(profile.digitalWill),
      synthetic_label: syntheticLabel(profile),
    },
  };
}

/**
 * The testable core of `POST /api/family`. Checks the asker before reading any
 * entry, sends only allowed entries, and re-validates the answer so P2 holds
 * for any injected Claude. (Req 9, 10)
 */
export async function answerFamilyQuestion(
  vault: Pick<VaultRepository, 'getProfile' | 'listVaultEntries'>,
  claude: FamilyClaude,
  userId: string,
  body: FamilyRequest,
): Promise<FamilyOutcome> {
  // 1. The profile.
  const profile = await vault.getProfile(userId);
  if (!profile) {
    return { status: 404, body: { error: 'Profile not found' } };
  }

  // 2. Only a relative the person named; no entries read, no Claude call. (Req 9.1)
  if (!isAllowedAsker(profile.digitalWill, body.asker)) {
    return { status: 403, body: { error: 'not_in_family_mode_access' } };
  }

  // 3. At most 40 entries, never a style example. (Req 9.2)
  const entries = selectFamilyEntries(await vault.listVaultEntries(userId));

  // 4. Nothing to ground an answer in: no Claude call. (Req 9.4)
  // 5. Otherwise ask Claude, then re-validate the citations. (Req 9.3, 9.5, 10)
  const result =
    entries.length === 0
      ? { answer: dontKnowAnswer(profile.firstName), cited_entry_ids: [] }
      : validateFamilyAnswer(
          await claude.familyAnswer({
            firstName: profile.firstName,
            question: body.question,
            entries,
          }),
          entries,
          profile.firstName,
        );

  // 6. Only the cited entries, in citation order. (Req 10.5, 10.6)
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const cited_entries = result.cited_entry_ids.flatMap((id) => {
    const entry = byId.get(id);
    // selectFamilyEntries never sends a style example; the check narrows the type.
    return entry && entry.kind !== 'style_example'
      ? [{ id: entry.id, kind: entry.kind, text: entry.text }]
      : [];
  });

  return {
    status: 200,
    body: {
      asker: body.asker,
      answer: result.answer,
      cited_entries,
      synthetic_label: syntheticLabel(profile),
    },
  };
}

/** `GET /api/family`: the person's first name and who may ask. */
export async function GET(): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const outcome = await getFamilyAskers(new SupabaseVaultRepository(supabase), user.id);
  if (outcome.status !== 200) {
    return NextResponse.json(outcome.body, { status: outcome.status });
  }
  return NextResponse.json(FamilyAskersResponseSchema.parse(outcome.body));
}

/** `POST /api/family`: answer one question from a named relative. */
export async function POST(request: Request): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = FamilyRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const claude: FamilyClaude = { familyAnswer: (input) => defaultFamilyAnswer(input) };
  const outcome = await answerFamilyQuestion(
    new SupabaseVaultRepository(supabase),
    claude,
    user.id,
    parsed.data,
  );
  if (outcome.status !== 200) {
    return NextResponse.json(outcome.body, { status: outcome.status });
  }
  return NextResponse.json(FamilyResponseSchema.parse(outcome.body));
}
