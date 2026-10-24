# Implementation Plan: assistant-tasks

## Overview

This plan implements the `assistant-tasks` "second self" assistant on top of the existing
`twin-loop` codebase: a read-only synthetic inbox, Claude-drafted replies grounded in the
user's style examples, a pure draft state machine (`draft` → `approved` → `sent` /
`discarded`), a simulated send, and the three server routes that wire them together. Work
proceeds bottom-up: the pure `lib/drafts.ts` state machine and safety validator with their
property and unit tests first, then `lib/inbox.ts`, the SQL migration, the draft
repository, the zod schemas, the server-only Claude layer, and finally the three API routes
with unit tests.

Every task is tagged `[kiro]` and covers logic, database, schemas, the Claude layer,
routes, and tests only. The React screens (the assistant page / Draft_Screen) are built
separately by Claude Code and are intentionally excluded from this plan. Property tests
P1, P2, and P3 over `lib/drafts.ts` are required, not optional.

## Tasks

- [x] 1. [kiro] Implement the draft state machine and safety validator `lib/drafts.ts`
  - [x] 1.1 Implement the pure `transition` state machine
    - Define `DraftState` (`'draft' | 'approved' | 'sent' | 'discarded'`), `DraftEvent`
      (`'approve' | 'send' | 'discard' | 'edit'`), and the exported `DRAFT_STATES`,
      `DRAFT_EVENTS`, `TERMINAL_STATES` constants plus `isDraftState`/`isDraftEvent` guards
    - Implement `transition(state, event)` as a pure total function over the valid domain
      with the full transition table: `draft+approve→approved`, `approved+send→sent`,
      `draft+discard→discarded`, `approved+discard→discarded`, `approved+edit→draft`;
      every other valid pair (including `draft+send` and `draft+edit`, a self-transition)
      returns the received state; `sent` and `discarded` absorb every event; no I/O and no
      mutation of inputs
    - Note: `draft+edit→draft` is a self-transition already covered by the "every other
      valid pair returns the received state" rule — the pure function's behavior does not
      change; the edit `body` is a persistence concern threaded by `applyTransition` (task
      10.1)
    - Return `{ error: 'invalid_state' | 'invalid_event' }` when an argument is not a valid
      state/event, mutating nothing
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 4.12_
  - [x] 1.2 Write property test P1 for `transition` (tests/pbt)
    - **Property P1: Send only from approved** — for any sequence of `draft_event` values
      applied through `transition` starting from `draft`, the `sent` state is reached only
      on a `send` event applied to the `approved` state; no other path reaches `sent`
    - **Validates: Requirements 4.3, 4.7, 4.11**
  - [x] 1.3 Write property test P2 for `transition` (tests/pbt)
    - **Property P2: transition is pure and does not mutate the inbox** — for every state
      and event (including invalid inputs), `transition` returns a `draft_state` or a
      `TransitionError` without mutating its arguments, a frozen inbox fixture, or any
      Inbox_Message
    - **Validates: Requirements 4.10, 4.12, 1.2**
  - [x] 1.4 Write property test P3 for `transition` (tests/pbt)
    - **Property P3: Terminal states are terminal** — for the states `sent` and
      `discarded` and every `draft_event`, `transition` returns the same state it was given
    - **Validates: Requirements 4.8, 4.9**
  - [x] 1.5 Implement `validateDraftSafety` and write its unit tests
    - Implement the pure `validateDraftSafety(draftText, sourceMessageBody)` returning
      `{ ok: true } | { ok: false; reason: string }`: reject drafts that introduce health
      content not present in `sourceMessageBody`, that state or imply a condition /
      diagnosis / risk, or that give health guidance stronger than the single allowed
      sentence "You might want to talk to your doctor about this."
    - Implement `HEALTH_TERMS` and `SCHEDULING_WORDS` as named exported constants in
      `lib/drafts.ts`: `HEALTH_TERMS` includes a `diagnos` prefix (matching
      diagnose/diagnosis/diagnostic); `SCHEDULING_WORDS` includes
      appointment/visit/doctor/`Dr.`/clinic/office/confirm/reschedule. A `HEALTH_TERMS`
      term is a violation only when absent from the source message body, matched
      case-insensitively; `SCHEDULING_WORDS` are never health terms
    - Write unit tests covering a clean pass, an added-diagnosis rejection, an added
      health-claim rejection, over-strong guidance rejection, and the exact allowed
      sentence passing
    - Add a required case: a plain confirmation reply passes `validateDraftSafety` for
      EVERY message in `data/synthetic/maya/inbox.json` (ids `m1`–`m5`), e.g.
      "Thursday at 9:40 works for me. See you then. Maya"
    - _Requirements: 7.1, 7.2, 7.3_

- [x] 2. [kiro] Implement the read-only inbox module `lib/inbox.ts`
  - [x] 2.1 Implement `loadInbox` and `relativeTimeLabel`
    - Define `InboxMessage` and `InboxResult` types; implement `loadInbox(filePath?)` to
      read and parse `data/synthetic/maya/inbox.json` at request time, returning every
      message on success or `{ ok: false, error: 'inbox_unavailable' }` on a read/parse
      failure, performing no database write
    - Implement the pure `relativeTimeLabel(receivedDaysAgo)`: `0`→"Today", `1`→"1 day
      ago", integer `N` in `[2, 3650]`→"N days ago", and any absent/null/non-integer/
      negative/`>3650` value→empty string, never throwing
    - _Requirements: 1.1, 1.2, 1.3, 1.6, 2.1, 2.2, 2.3, 2.4_
  - [x] 2.2 Write unit tests for `loadInbox` and `relativeTimeLabel`
    - Assert `loadInbox` returns all messages including the "Dr. Lee's office, Valley
      Family Medicine" message, and `{ ok: false }` on a missing/corrupt file; assert the
      `relativeTimeLabel` boundaries 0, 1, 2, 3650, 3651, -1, null, and a non-integer
    - _Requirements: 1.1, 1.4, 1.6, 2.1, 2.2, 2.3, 2.4_

- [x] 3. [kiro] Write the SQL migration `supabase/migrations/0002_assistant.sql`
  - Create the `drafts` table (`id`, `user_id`, `inbox_message_id`, `body`, `state` with a
    CHECK over the four `DraftState` values defaulting to `'draft'`, nullable `sent_at`,
    `created_at`) plus the `drafts_sent_at_iff_sent` CHECK making `sent_at` non-null iff
    `state = 'sent'`
  - Enable RLS on `drafts` with select/insert/update/delete policies keyed on
    `user_id = auth.uid()`; do not alter the `twin-loop` tables
  - _Requirements: 4.1, 5.1, 5.3, 6.6_

- [x] 4. [kiro] Implement the draft repository `lib/db/draft-repository.ts`
  - [x] 4.1 Define the `DraftRepository` interface and `InMemoryDraftRepository`
    - Define `Draft`, `NewDraft`, `DraftPatch` types and the interface methods
      `createDraft` (state `'draft'`, `sent_at` null), `getDraft`, `updateDraft`,
      `deleteDraft`, `deleteAllDrafts`; implement `InMemoryDraftRepository` as a
      `Map<string, Draft[]>` keyed by `userId` that returns copies so callers cannot mutate
      stored rows by reference
    - `DraftPatch` carries an optional `body`; `updateDraft` writes the new `body` when
      `patch.body` is present and leaves the stored body unchanged when it is omitted
    - `deleteAllDrafts(userId)` removes EVERY Draft owned by the caller (InMemory: empties
      that user's entry in the map), used by the "delete my vault" path
    - _Requirements: 3.5, 4.6, 5.3, 6.3, 6.6_
  - [x] 4.2 Write unit tests for `InMemoryDraftRepository`
    - Assert create yields `state='draft'` and `sent_at=null`; get/update/delete are
      scoped to `userId`; returned rows are copies; delete removes only the caller's row;
      `updateDraft` with `patch.body` replaces the stored body and without it leaves the
      body unchanged; `deleteAllDrafts(userId)` empties only the caller's drafts
    - _Requirements: 3.5, 4.6, 5.3, 6.3, 6.6_
  - [x] 4.3 Implement `SupabaseDraftRepository`
    - Use the request-scoped `@supabase/ssr` server client so every statement runs under
      the caller's `auth.uid()`; map camelCase fields to snake_case columns; filter every
      method by `user_id = userId`
    - `updateDraft` writes the `body` column only when `patch.body` is present;
      `deleteAllDrafts(userId)` issues a single `delete … where user_id = userId` over the
      `drafts` table
    - _Requirements: 3.5, 4.6, 5.3, 6.3, 6.6_
  - [x] 4.4 [kiro] Update `deleteVaultForUser` to also delete the caller's drafts
    - Update `app/api/vault/route.ts` so `deleteVaultForUser` takes an added
      `DraftRepository` parameter and calls `draftRepo.deleteAllDrafts(userId)` alongside
      `repo.deleteVault(userId)`, so clearing a user's vault also clears their drafts; wire
      the production `SupabaseDraftRepository` in the `DELETE` handler
    - _Requirements: 6.6_

- [x] 5. [kiro] Add the assistant zod schemas to `lib/api-schemas.ts` and `lib/claude/schemas.ts`
  - Add to `lib/api-schemas.ts` (zod only, no server-only imports) the request schemas for
    `POST /api/assistant/draft` (`{ inbox_message_id }`) and `POST /api/assistant/transition`
    (`{ draft_id, event, body? }`), and the `DraftResponse` and inbox response
    (`{ synthetic_label, messages }`) shapes
    - The transition request schema includes an OPTIONAL `body` (`z.string().min(1).max(2000)`)
      that is allowed ONLY with the `edit` event; add a `.refine` rejecting a `body` supplied
      with any other event (400 / schema error)
    - _Requirements: 1.5, 3.1, 3.2, 4.1, 4.6, 6.3_
  - Add `DraftSchema = z.object({ draft: z.string() })` to `lib/claude/schemas.ts` and
    re-export the assistant request/response schemas from `lib/api-schemas.ts` for server use
    - _Requirements: 3.3, 7.4_

- [x] 6. Checkpoint - Ensure pure-module, migration, repository, and schema tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. [kiro] Extend the server-only Claude layer for drafting `lib/claude/`
  - [x] 7.1 Add the draft prompts to `lib/claude/prompts.ts`
    - Add `DRAFT_REPLY_SYSTEM` (write a short reply in the user's voice using the style
      examples only as a tone/phrasing guide; carry the Req 7 safety rules: add no health
      content beyond the Inbox_Message, never state/imply a condition/diagnosis/risk, use no
      guidance stronger than "You might want to talk to your doctor about this."),
      `buildDraftReplyUserMessage({ message, styleExamples })` (formats the message and the
      up-to-five examples, noting "no style examples available" when empty),
      `DRAFT_SAFETY_RETRY_SUFFIX`, and `DRAFT_GENERATION_ERROR`
    - _Requirements: 3.3, 3.4, 7.1, 7.2, 7.3_
  - [x] 7.2 Implement `draftReply` in `lib/claude/index.ts`
    - Implement the server-only `draftReply({ message, styleExamples }, client?)` returning
      `{ ok: true; text } | { ok: false; reason: 'timeout' | 'refusal' | 'unsafe' }`: model
      `"claude-opus-5-5"`, no temperature/top_p/top_k, no assistant prefill, `stop_reason
      === 'refusal'` check before reading content; wrap the call in a 30s timeout
      (`reason: 'timeout'`); validate with `validateDraftSafety`, retry ONCE with
      `DRAFT_SAFETY_RETRY_SUFFIX` on failure, and return `reason: 'unsafe'` if the retry
      also fails validation
    - _Requirements: 3.6, 3.7, 7.4, 7.5_
  - [x] 7.3 Write unit tests for `draftReply` with a mocked client
    - Assert a safe first draft returns `{ ok: true }`; an unsafe first draft that the retry
      fixes returns `{ ok: true }`; two unsafe drafts return `{ ok: false, reason: 'unsafe' }`;
      a refusal returns `{ ok: false, reason: 'refusal' }`; a slow call returns
      `{ ok: false, reason: 'timeout' }`
    - _Requirements: 3.7, 7.4, 7.5_

- [x] 8. [kiro] Implement `GET /api/assistant/inbox` with unit tests
  - [x] 8.1 Implement the route
    - Call `loadInbox()`; on `{ ok: false }` respond 503 `{ error: 'inbox_unavailable' }`
      writing nothing; on success map each message to `{ ...message, relative_time_label }`
      via `relativeTimeLabel(received_days_ago)` and respond
      `{ synthetic_label: 'Synthetic data', messages }`; never write to the database
    - _Requirements: 1.1, 1.2, 1.5, 1.6, 2.1, 2.2, 2.3, 2.4_
  - [x] 8.2 Write unit tests for the inbox route
    - Assert a loadable inbox yields `synthetic_label` plus messages with relative-time
      labels and the doctor's-office message; an unavailable inbox yields 503 and no write
    - _Requirements: 1.5, 1.6, 2.1_

- [x] 9. [kiro] Implement `POST /api/assistant/draft` with unit tests
  - [x] 9.1 Implement the route and exported `createDraft`
    - Implement the thin handler plus the exported
      `createDraft(drafts, vault, claude, userId, body)` taking the repository and the
      Claude function as arguments: find the Inbox_Message by `inbox_message_id` via
      `loadInbox()` (404 unknown / 503 unavailable, creating no Draft); read the caller's
      vault entries, keep `kind === 'style_example'`, take at most the 5 most recent as
      style grounding (empty list when none, still drafting); call `claude.draftReply`
      (Claude reached only here); on failure return 502 `draft_generation_failed` creating
      no Draft; on a safe draft `drafts.createDraft(userId, { inboxMessageId, body })` with
      `state='draft'`, `sent_at=null`, and respond `{ draft: DraftResponse }`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 5.3, 7.5_
  - [x] 9.2 Write unit tests (in-memory repos + mocked Claude)
    - Assert a safe draft is stored with `state='draft'` and `sent_at=null`; up to 5 style
      examples are passed and the most recent are chosen; zero style examples still drafts;
      an unknown message yields 404 and no Draft; a Claude failure/timeout/unsafe result
      yields 502 and no Draft
    - _Requirements: 3.3, 3.4, 3.5, 3.7, 7.5_

- [x] 10. [kiro] Implement `POST /api/assistant/transition` with unit tests
  - [x] 10.1 Implement the route and exported `applyTransition`
    - Implement the thin handler plus the exported
      `applyTransition(drafts, userId, body)` taking the repository as an argument (with
      the optional `body` threaded through): load the caller's Draft (404 if not
      found/owned); validate `event` with `isDraftEvent` (400 on invalid); compute
      `next = transition(draft.state, event)`; on `discarded` delete the Draft via
      `deleteDraft` and acknowledge `{ discarded: true }`; on `sent` (only from
      `approved+send`) record a millisecond-precision server-clock `sent_at` using only
      in-application state with no outbound connection, persisting `{ state:'sent', sentAt }`,
      and on a record failure reject the transition, retain the prior state, keep `sent_at`
      null, and return an error
    - On an `edit` event with a `body`, store the new body AS WRITTEN — do NOT run
      `validateDraftSafety` on user-supplied edit text — and persist both the new `body`
      and the state from `transition` (`approved+edit→draft` and the self-transition
      `draft+edit→draft`), with `sent_at` staying null; an `edit` without a body applies
      only the state transition and leaves the body unchanged
    - For every other transition persist `{ state: next, sentAt: null }`; respond
      `{ draft: DraftResponse }`
    - _Requirements: 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.11, 5.1, 5.2, 5.3, 5.4, 6.3, 6.5, 6.6_
  - [x] 10.2 Write unit tests (in-memory repo)
    - Assert `draft+approve→approved`; `approved+send→sent` with a non-null millisecond
      `sent_at` and no outbound call; `approved+edit→draft`; `draft+discard` and
      `approved+discard` delete the row and never send; `draft+send` is a no-op keeping
      `sent_at` null; an invalid event yields 400; a `sent_at` record failure retains the
      prior state with `sent_at` null and errors
    - Add required edit-with-body cases: an `edit` with a `body` in the `draft` state
      (body stored as written, resulting state `draft`, `sent_at` null) and in the
      `approved` state (body stored as written, resulting state `draft`, `sent_at` null);
      and a case asserting a `body` supplied with a non-`edit` event is rejected
      (400 / schema error)
    - _Requirements: 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.11, 5.1, 5.3, 5.4, 6.3, 6.6_

- [x] 11. Checkpoint - Ensure all route, property, and unit tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. [kiro] Boundary/smoke tests
  - [x] 12.1 Assert the synthetic inbox contains the doctor's-office message and that the
    Claude import appears only in server code
    - Assert `data/synthetic/maya/inbox.json` parses as an Inbox_Message collection and
      includes the "Dr. Lee's office, Valley Family Medicine" appointment message; assert
      `@anthropic-ai/sdk` / `lib/claude` imports appear only under server routes and
      `lib/claude/`, never in client modules
    - _Requirements: 1.4, 3.6_

- [x] 13. [kiro] Extend twin-loop property P4 to cover drafts deletion
  - Extend the twin-loop "delete leaves nothing" property P4 in
    `tests/pbt/delete-vault.test.ts` so that after `deleteVaultForUser` the caller's drafts
    are also empty (`deleteAllDrafts` was called), while every other user's drafts remain;
    seed an `InMemoryDraftRepository` alongside the vault repo and assert the target user's
    drafts are gone and others' are unchanged
  - **Property P4 (extended): Delete leaves nothing — including drafts** (extends
    twin-loop's P4 / the design's drafts-deletion property)
  - **Validates: Requirements 6.6**

## Notes

- Every task is tagged `[kiro]` and covers logic, database, schemas, the Claude layer,
  routes, and tests. The React screens (the assistant page / Draft_Screen) are built
  separately by Claude Code and are deliberately excluded from this plan.
- Property tests P1, P2, and P3 over `lib/drafts.ts` (tasks 1.2, 1.3, 1.4) are required and
  are NOT marked optional. The extended twin-loop property P4 (task 13), which asserts that
  "delete my vault" also clears the caller's drafts, is likewise required.
- Required safety-path tasks also include the `validateDraftSafety` unit tests (1.5) and the
  two route logic tasks (9.1/9.2, 10.1/10.2) that enforce "nothing is sent without
  approval" and the Req 7 draft-safety validation. The supporting unit-test tasks 2.2, 4.2,
  7.3, and 8.2 are now required (no longer optional). The only remaining optional (`*`)
  sub-task is 12.1 (boundary/smoke tests).
- Each task references the specific requirements (and any property P1–P3) it satisfies.
- Checkpoints validate incrementally at each natural break.
- "Send" is simulated: `applyTransition` records `sent_at` on the server clock with no
  outbound connection (task 10.1), structurally guaranteed by P1 (only `approved+send`
  reaches `sent`).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "3", "5"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4", "1.5", "2.2", "4.1", "7.1"] },
    { "id": 2, "tasks": ["4.2", "4.3", "7.2", "8.1"] },
    { "id": 3, "tasks": ["4.4", "7.3", "8.2", "9.1", "10.1"] },
    { "id": 4, "tasks": ["9.2", "10.2", "12.1", "13"] }
  ]
}
```
