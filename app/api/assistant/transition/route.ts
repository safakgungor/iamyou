/**
 * `POST /api/assistant/transition` — move a Draft between states through the
 * pure `transition` state machine, simulate "send" on the server clock, and
 * persist the result.
 *
 * The HTTP handler is deliberately thin: it reads the authenticated caller,
 * parses and validates the request body with `TransitionRequestSchema` (which
 * already rejects a `body` supplied with a non-`edit` event via its `.refine`
 * → 400), wires the production `SupabaseDraftRepository` (request-scoped under
 * the caller's `auth.uid()`), and delegates every decision to `applyTransition`.
 * Keeping the logic in an injectable helper lets task 10.2 unit test it with
 * `InMemoryDraftRepository`, with no HTTP, auth, or network.
 *
 * "Send" is SIMULATED: `applyTransition` records `sent_at` on the server clock
 * (millisecond precision) using only in-application state and never opens an
 * outbound connection (Req 5.1, 5.2). The pure `transition` function structurally
 * guarantees `sent` is reachable only from `approved + send` (property P1), so
 * nothing is ever sent without approval (AGENTS.md rule 4).
 *
 * Flow (design "POST /api/assistant/transition", Req 4, 5, 6):
 *   1. Load the caller's Draft via `drafts.getDraft`; 404 if not found / not owned.
 *   2. Validate `event` with `isDraftEvent`; 400 on an invalid event.
 *   3. Compute `next = transition(draft.state, event)`. A `TransitionError` here
 *      indicates a corrupt stored state; treat as 500.
 *   4. Discard (`next === 'discarded'`): delete the Draft via `deleteDraft` and
 *      acknowledge `{ discarded: true }`. (Req 4.4, 4.5, 6.6)
 *   5. Send (`next === 'sent'`, only from `approved + send`): record a
 *      millisecond-precision `sent_at` on the server clock with no outbound
 *      connection and persist `{ state: 'sent', sentAt }`. On a record failure,
 *      reject the transition, retain the prior state, keep `sent_at` null, and
 *      return 500. (Req 5.1, 5.2, 5.4)
 *   6. Edit WITH a body: store the new body AS WRITTEN (no `validateDraftSafety`
 *      on user-typed text) and persist both the new body and the state from
 *      `transition` (`approved + edit → draft`, and the self-transition
 *      `draft + edit → draft`), with `sent_at` null. An edit WITHOUT a body
 *      applies only the state transition and leaves the body unchanged. (Req
 *      4.6, 4.11, 6.3, 6.5)
 *   7. Every other transition: persist `{ state: next, sentAt: null }`. (Req 5.3)
 *   8. Respond `{ draft: DraftResponse }`.
 *
 * Requirements: 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.11, 5.1, 5.2, 5.3, 5.4, 6.3,
 * 6.5, 6.6.
 */

import { NextResponse } from 'next/server';

import { isDraftEvent, transition } from '../../../../lib/drafts';
import type { DraftEvent } from '../../../../lib/drafts';
import type { Draft, DraftRepository } from '../../../../lib/db/draft-repository';
import { SupabaseDraftRepository } from '../../../../lib/db/draft-repository';
import { TransitionRequestSchema } from '../../../../lib/api-schemas';
import type { DraftResponse } from '../../../../lib/api-schemas';
import { createSupabaseServerClient } from '../../../../lib/db/supabase-server';

/** The parsed request body handled by `applyTransition`. */
export type ApplyTransitionBody = {
  draft_id: string;
  event: string;
  body?: string;
};

/**
 * The possible outcomes of `applyTransition`, mapped to HTTP status by the
 * handler:
 *   - 404 — the Draft was not found or is not owned by the caller.
 *   - 400 — the `event` is not a valid `draft_event`.
 *   - 500 — a corrupt stored state, or a `sent_at` record failure (Req 5.4).
 *   - 200 — the updated Draft, or a `{ discarded: true }` acknowledgement.
 */
export type ApplyTransitionOutcome =
  | { status: 404; body: { error: string } }
  | { status: 400; body: { error: string } }
  | { status: 500; body: { error: string } }
  | { status: 200; body: { draft: DraftResponse } | { discarded: true } };

/** Shapes a stored `Draft` into the public `DraftResponse` wire shape. */
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
 * The testable core of the transition route. Loads the caller's Draft, runs the
 * pure state machine, and persists the result — deleting the row on discard,
 * recording `sent_at` on a simulated send, and threading an optional edited
 * `body` through on the edit path.
 *
 * The repository and the resolved `userId` are passed in so this runs under
 * `InMemoryDraftRepository` in task 10.2, with no HTTP, auth, or network.
 */
export async function applyTransition(
  drafts: DraftRepository,
  userId: string,
  body: ApplyTransitionBody,
): Promise<ApplyTransitionOutcome> {
  // 1. Load the caller's Draft; 404 if not found / not owned.
  const draft = await drafts.getDraft(userId, body.draft_id);
  if (!draft) {
    return { status: 404, body: { error: 'Draft not found' } };
  }

  // 2. Validate the event; 400 on an invalid event (mirrors Req 4.12 at the
  //    HTTP boundary).
  if (!isDraftEvent(body.event)) {
    return { status: 400, body: { error: 'Invalid event' } };
  }
  const event: DraftEvent = body.event;

  // 3. Compute the next state with the pure state machine. A TransitionError
  //    here means the stored state is corrupt; treat as 500.
  const next = transition(draft.state, event);
  if (typeof next !== 'string') {
    return { status: 500, body: { error: 'Corrupt draft state' } };
  }

  // 4. Discard: remove the Draft entirely and acknowledge. The `discarded`
  //    state is the transient result that authorizes the removal; the row is
  //    then deleted so the contents are never sent. (Req 4.4, 4.5, 6.6)
  if (next === 'discarded') {
    await drafts.deleteDraft(userId, draft.id);
    return { status: 200, body: { discarded: true } };
  }

  // 5. Simulated send: reachable only from `approved + send` (P1). Record
  //    `sent_at` on the server clock with millisecond precision using only
  //    in-application state and NO outbound connection. (Req 5.1, 5.2)
  if (next === 'sent') {
    const sentAt = new Date().toISOString();
    try {
      const updated = await drafts.updateDraft(userId, draft.id, {
        state: 'sent',
        sentAt,
      });
      return { status: 200, body: { draft: toDraftResponse(updated) } };
    } catch {
      // Recording `sent_at` failed: reject the transition, retain the prior
      // state, keep `sent_at` null, and surface an error. (Req 5.4)
      return { status: 500, body: { error: 'Failed to record send' } };
    }
  }

  // 6. Edit WITH a body: the edited text is the user's own writing, so it is
  //    stored AS WRITTEN — `validateDraftSafety` is NOT run on it (that screen
  //    guards only Claude-generated drafts). Persist both the new body and the
  //    state from `transition` (`approved + edit → draft` and the self-transition
  //    `draft + edit → draft`), with `sent_at` null. (Req 4.6, 4.11, 6.3, 6.5)
  if (event === 'edit' && body.body !== undefined) {
    const updated = await drafts.updateDraft(userId, draft.id, {
      state: next,
      sentAt: null,
      body: body.body,
    });
    return { status: 200, body: { draft: toDraftResponse(updated) } };
  }

  // 7. Every other transition (approve, edit without a body, or a no-op such as
  //    `draft + send`): persist the new state with `sent_at` null; the body is
  //    left unchanged. (Req 4.2, 4.7, 5.3)
  const updated = await drafts.updateDraft(userId, draft.id, {
    state: next,
    sentAt: null,
  });
  return { status: 200, body: { draft: toDraftResponse(updated) } };
}

/**
 * Thin HTTP handler: resolves the caller, validates the body, wires the
 * production `SupabaseDraftRepository`, and delegates to `applyTransition`.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient();

  // Require an authenticated caller.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Validate the request body. The schema's `.refine` already rejects a `body`
  // supplied with a non-`edit` event (400).
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = TransitionRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 },
    );
  }

  const drafts = new SupabaseDraftRepository(supabase);
  const outcome = await applyTransition(drafts, user.id, parsed.data);
  return NextResponse.json(outcome.body, { status: outcome.status });
}
