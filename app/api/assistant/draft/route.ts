/**
 * `POST /api/assistant/draft` — draft a reply to a synthetic Inbox_Message in
 * the user's voice, grounded in the caller's style examples, and store it in
 * the `draft` state. Nothing is ever sent here: this route only creates a Draft.
 *
 * The HTTP handler is deliberately thin: it reads the authenticated caller,
 * parses the request body, wires up the production `DraftRepository` and
 * `VaultRepository` (Supabase, request-scoped under the caller's `auth.uid()`)
 * and the server-only Claude `draftReply`, and delegates every decision to
 * `createDraft`. Keeping the logic in a helper that takes its collaborators as
 * arguments lets task 9.2 unit test it with `InMemoryDraftRepository`,
 * `InMemoryVaultRepository`, and a mocked Claude, with no HTTP, auth, or network.
 *
 * Flow (design "POST /api/assistant/draft", Req 3, 5.3, 7.5):
 *   1. Require an authenticated caller; 401 if none.
 *   2. Validate the body with `DraftRequestSchema`; 400 on parse failure.
 *   3. Load the synthetic inbox via `loadInbox()`:
 *        - 503 `{ error: 'inbox_unavailable' }` when the inbox cannot be read,
 *          creating no Draft. (Req 1.6)
 *        - 404 `{ error }` when no Inbox_Message matches `inbox_message_id`,
 *          creating no Draft. (Req 3.1, 3.2)
 *   4. Read the caller's vault entries, keep `kind === 'style_example'`, and
 *      take at most the 5 most recent (by `createdAt`) as style grounding; an
 *      empty list is fine — the Draft is still created. (Req 3.3, 3.4)
 *   5. `claude.draftReply({ message, styleExamples })` — Claude is reached ONLY
 *      here. (Req 3.6)
 *   6. On a failure result (`ok: false` — timeout / refusal / unsafe), return
 *      502 `{ error: 'draft_generation_failed' }`, creating no Draft. (Req 3.7, 7.5)
 *   7. On a safe draft, `drafts.createDraft(userId, { inboxMessageId, body })`
 *      with `state='draft'` and `sent_at=null`, and respond 200
 *      `{ draft: DraftResponse }`. (Req 3.5, 5.3)
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 5.3, 7.5.
 */

import { NextResponse } from 'next/server';

import { loadInbox } from '../../../../lib/inbox';
import { DraftRequestSchema, type DraftResponse } from '../../../../lib/api-schemas';
import { draftReply as defaultDraftReply } from '../../../../lib/claude';
import type { DraftReplyResult } from '../../../../lib/claude';
import type { Draft, DraftRepository } from '../../../../lib/db/draft-repository';
import { SupabaseDraftRepository } from '../../../../lib/db/draft-repository';
import type { VaultRepository } from '../../../../lib/db/vault-repository';
import { SupabaseVaultRepository } from '../../../../lib/db/vault-repository';
import { createSupabaseServerClient } from '../../../../lib/db/supabase-server';

/** The most recent style examples carried into a draft call. (Req 3.3) */
const MAX_STYLE_EXAMPLES = 5;

/**
 * The Claude collaborator `createDraft` needs, narrowed to the one function it
 * calls. Injecting this lets task 9.2 pass a mock instead of the real client.
 * The signature mirrors `draftReply` in `lib/claude`. (Req 3.6, 3.7, 7.5)
 */
export interface DraftClaude {
  draftReply(input: {
    message: { from: string; subject: string; body: string };
    styleExamples: string[];
  }): Promise<DraftReplyResult>;
}

/** The parsed, validated request body handled by `createDraft`. */
export type CreateDraftBody = {
  inbox_message_id: string;
};

/**
 * The possible outcomes of `createDraft`, mapped to HTTP status by the handler:
 *   404 — unknown Inbox_Message (no Draft created) (Req 3.1, 3.2)
 *   503 — synthetic inbox unavailable (no Draft created) (Req 1.6)
 *   502 — draft generation failed (no Draft created) (Req 3.7, 7.5)
 *   200 — a safe Draft was created in the `draft` state (Req 3.5, 5.3)
 */
export type CreateDraftOutcome =
  | { status: 404; body: { error: string } }
  | { status: 503; body: { error: 'inbox_unavailable' } }
  | { status: 502; body: { error: 'draft_generation_failed' } }
  | { status: 200; body: { draft: DraftResponse } };

/**
 * Maps a stored camelCase `Draft` to the public snake_case `DraftResponse`
 * shape returned by the route: `{ id, inbox_message_id, body, state, sent_at }`.
 */
function toDraftResponse(draft: Draft): DraftResponse {
  return {
    id: draft.id,
    inbox_message_id: draft.inboxMessageId,
    body: draft.body,
    state: draft.state,
    sent_at: draft.sentAt,
  };
}

/**
 * The testable core of the draft route. Finds the target Inbox_Message in the
 * synthetic inbox, gathers the caller's style examples, asks Claude for a safe
 * draft, and — only on success — stores it in the `draft` state.
 *
 * Collaborators (`drafts`, `vault`, `claude`) and the resolved `userId` are
 * passed in so this runs under the in-memory repositories + a mocked Claude in
 * task 9.2. Claude is reached ONLY through `claude.draftReply`. (Req 3.6)
 */
export async function createDraft(
  drafts: DraftRepository,
  vault: VaultRepository,
  claude: DraftClaude,
  userId: string,
  body: CreateDraftBody,
): Promise<CreateDraftOutcome> {
  // 3. Load the synthetic inbox and find the target message.
  const inbox = loadInbox();
  if (!inbox.ok) {
    // The synthetic inbox is unavailable; create no Draft. (Req 1.6)
    return { status: 503, body: { error: 'inbox_unavailable' } };
  }

  const message = inbox.messages.find((m) => m.id === body.inbox_message_id);
  if (!message) {
    // No Inbox_Message matches the requested id; create no Draft. (Req 3.1, 3.2)
    return { status: 404, body: { error: 'Inbox message not found' } };
  }

  // 4. Gather the caller's style examples: keep `style_example` entries and
  //    take at most the 5 most recent (by createdAt). An empty list is fine —
  //    the Draft is still created without style grounding. (Req 3.3, 3.4)
  const entries = await vault.listVaultEntries(userId);
  const styleExamples = entries
    .filter((e) => e.kind === 'style_example')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, MAX_STYLE_EXAMPLES)
    .map((e) => e.text);

  // 5. Ask Claude for a safe draft — Claude is reached ONLY here. (Req 3.6)
  const result = await claude.draftReply({
    message: {
      from: message.from,
      subject: message.subject,
      body: message.body,
    },
    styleExamples,
  });

  // 6. On any failure (timeout / refusal / unsafe), create no Draft. (Req 3.7, 7.5)
  if (!result.ok) {
    return { status: 502, body: { error: 'draft_generation_failed' } };
  }

  // 7. Store the safe draft in the `draft` state with `sent_at` null. (Req 3.5, 5.3)
  const created = await drafts.createDraft(userId, {
    inboxMessageId: message.id,
    body: result.text,
  });

  return { status: 200, body: { draft: toDraftResponse(created) } };
}

/**
 * Thin HTTP handler: resolves the caller, validates the body, wires the
 * production collaborators, and delegates to `createDraft`.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient();

  // 1. Require an authenticated caller.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2. Validate the request body.
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = DraftRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 },
    );
  }

  const drafts = new SupabaseDraftRepository(supabase);
  const vault = new SupabaseVaultRepository(supabase);
  const claude: DraftClaude = {
    draftReply: (input) => defaultDraftReply(input),
  };

  const outcome = await createDraft(drafts, vault, claude, user.id, parsed.data);
  return NextResponse.json(outcome.body, { status: outcome.status });
}
