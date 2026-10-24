/**
 * `POST /api/summary` — the clinician summary. (care-outputs Req 1–4)
 *
 * The handler is thin: it resolves the caller, validates the body, wires the
 * production repositories and a server clock, and delegates to `getSummary`,
 * which unit tests run with in-memory repositories. The summary itself is the
 * pure `buildSummary` in `lib/summary.ts`, so this route stores nothing and
 * calls no model (Req 1.7, 4.6). The person's `discuss` and `contact` input only
 * shape this response; they are not stored.
 *
 * Requirements: 1.7, 2.5, 3.4, 4.1, 4.2, 4.3, 4.6.
 */

import { NextResponse } from 'next/server';

import {
  SummaryRequestSchema,
  SummaryResponseSchema,
  type SummaryRequest,
  type SummaryResponse,
} from '@/lib/api-schemas';
import { SupabaseVaultRepository, type VaultRepository } from '@/lib/db/vault-repository';
import {
  SupabaseWeeklyFeatureRepository,
  type WeeklyFeatureRepository,
} from '@/lib/db/weekly-feature-repository';
import { createSupabaseServerClient } from '@/lib/db/supabase-server';
import { SYNTHETIC_LABEL, buildSummary, type SummaryDeps } from '@/lib/summary';

export type SummaryOutcome =
  | { status: 404; body: { error: string } }
  | { status: 200; body: SummaryResponse };

/** Today's date (UTC) as an ISO date, the summary date. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The testable core of the summary route. Reads only; writes nothing. */
export async function getSummary(
  vault: Pick<VaultRepository, 'getProfile'>,
  weekly: Pick<WeeklyFeatureRepository, 'listWeeklyFeatures'>,
  userId: string,
  body: SummaryRequest,
  today: () => string = todayIso,
  deps?: SummaryDeps,
): Promise<SummaryOutcome> {
  const profile = await vault.getProfile(userId);
  if (!profile) {
    return { status: 404, body: { error: 'Profile not found' } };
  }

  const rows = await weekly.listWeeklyFeatures(userId);
  const summary = buildSummary(
    {
      profile,
      rows,
      summaryDate: today(),
      discussText: body.discuss ?? null,
      contact: body.contact ?? null,
    },
    deps,
  );

  return {
    status: 200,
    body: { ...summary, synthetic_label: summary.synthetic ? SYNTHETIC_LABEL : null },
  };
}

/** Thin HTTP handler: resolves the caller, validates the body, delegates. */
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
  const parsed = SummaryRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const outcome = await getSummary(
    new SupabaseVaultRepository(supabase),
    new SupabaseWeeklyFeatureRepository(supabase),
    user.id,
    parsed.data,
  );
  if (outcome.status !== 200) {
    return NextResponse.json(outcome.body, { status: outcome.status });
  }
  return NextResponse.json(SummaryResponseSchema.parse(outcome.body));
}
