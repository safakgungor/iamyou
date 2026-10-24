// Feature: assistant-tasks, Task 10.2: unit tests for the transition route.
//
// These tests exercise the exported `applyTransition(drafts, userId, body)` of
// `app/api/assistant/transition/route.ts` with an `InMemoryDraftRepository`.
// `applyTransition` is the testable core of `POST /api/assistant/transition`:
// it loads the caller's Draft, runs the pure `transition` state machine, and
// persists the result — deleting the row on discard, recording a
// millisecond-precision server-clock `sent_at` on a simulated send (no outbound
// connection), and threading an optional edited `body` through on the edit path.
//
// `InMemoryDraftRepository` only exposes create/get/update/delete/deleteAll, so
// the `approved` state is reached by creating a draft then driving it through
// `applyTransition` with an `approve` event (or by `updateDraft` directly).
//
// Covered behaviours (Req 4.2–4.7, 4.11, 5.1, 5.3, 5.4, 6.3, 6.6):
//   - draft + approve → approved (Req 4.2);
//   - approved + send → sent with a non-null, millisecond-precision `sent_at`
//     and NO outbound call (Req 4.3, 5.1, 5.3);
//   - approved + edit → draft (Req 4.6);
//   - draft + discard and approved + discard delete the row (getDraft → null)
//     and never send, acknowledging 200 { discarded: true } (Req 4.4, 4.5, 6.6);
//   - draft + send is a no-op keeping state `draft` and `sent_at` null (Req 4.7);
//   - an invalid event yields 400 (Req 4.12 at the boundary);
//   - a `sent_at` record failure retains the prior state with `sent_at` null and
//     errors (500) (Req 5.4);
//   - an `edit` with a `body` in the `draft` and `approved` states stores the
//     body as written, resulting in state `draft` with `sent_at` null (Req 4.11,
//     6.3);
//   - a `body` supplied with a non-`edit` event is rejected by
//     `TransitionRequestSchema` (400 / schema error) (Req 4.6).
//
// Validates: Requirements 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.11, 5.1, 5.3, 5.4, 6.3, 6.6
import { describe, expect, it } from "vitest";

import {
  applyTransition,
  type ApplyTransitionBody,
} from "@/app/api/assistant/transition/route";
import {
  InMemoryDraftRepository,
  type Draft,
  type DraftPatch,
  type DraftRepository,
} from "@/lib/db/draft-repository";
import { TransitionRequestSchema } from "@/lib/api-schemas";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const USER_ID = "user-1";

/** Creates a repo with a single draft owned by USER_ID; returns both. */
async function seedDraft(): Promise<{
  repo: InMemoryDraftRepository;
  draft: Draft;
}> {
  const repo = new InMemoryDraftRepository();
  const draft = await repo.createDraft(USER_ID, {
    inboxMessageId: "m1",
    body: "Thursday at 9:40 works for me. See you then. Maya",
  });
  return { repo, draft };
}

/** Drives a seeded draft into the `approved` state via `applyTransition`. */
async function seedApprovedDraft(): Promise<{
  repo: InMemoryDraftRepository;
  draft: Draft;
}> {
  const { repo, draft } = await seedDraft();
  const outcome = await applyTransition(repo, USER_ID, {
    draft_id: draft.id,
    event: "approve",
  });
  expect(outcome.status).toBe(200);
  return { repo, draft };
}

/* -------------------------------------------------------------------------- */
/* draft + approve → approved                                                 */
/* -------------------------------------------------------------------------- */

describe("applyTransition — approve", () => {
  it("draft + approve → approved, sent_at null (Req 4.2, 5.3)", async () => {
    const { repo, draft } = await seedDraft();

    const outcome = await applyTransition(repo, USER_ID, {
      draft_id: draft.id,
      event: "approve",
    });

    expect(outcome.status).toBe(200);
    expect(outcome.body).toEqual({
      draft: expect.objectContaining({
        id: draft.id,
        state: "approved",
        sent_at: null,
      }),
    });

    const stored = await repo.getDraft(USER_ID, draft.id);
    expect(stored?.state).toBe("approved");
    expect(stored?.sentAt).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* approved + send → sent (simulated, no outbound call)                       */
/* -------------------------------------------------------------------------- */

describe("applyTransition — send", () => {
  it("approved + send → sent with a non-null, millisecond-precision sent_at (Req 4.3, 5.1, 5.3)", async () => {
    const { repo, draft } = await seedApprovedDraft();

    const before = Date.now();
    const outcome = await applyTransition(repo, USER_ID, {
      draft_id: draft.id,
      event: "send",
    });
    const after = Date.now();

    expect(outcome.status).toBe(200);
    expect("draft" in outcome.body).toBe(true);
    if (!("draft" in outcome.body)) throw new Error("expected a draft body");

    const sent = outcome.body.draft;
    expect(sent.state).toBe("sent");
    expect(sent.sent_at).not.toBeNull();

    // `sent_at` is a millisecond-precision ISO-8601 instant on the server clock.
    expect(sent.sent_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const stampedAt = new Date(sent.sent_at as string).getTime();
    expect(stampedAt).toBeGreaterThanOrEqual(before);
    expect(stampedAt).toBeLessThanOrEqual(after);

    // The simulated send persists the sent state and timestamp.
    const stored = await repo.getDraft(USER_ID, draft.id);
    expect(stored?.state).toBe("sent");
    expect(stored?.sentAt).toBe(sent.sent_at);
  });

  it("makes no outbound network connection while sending (Req 5.1)", async () => {
    const { repo, draft } = await seedApprovedDraft();

    // Any attempt at an outbound HTTP call fails the test: the send is simulated
    // entirely from in-application state and the server clock.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("applyTransition must not make an outbound call on send");
    }) as typeof fetch;

    try {
      const outcome = await applyTransition(repo, USER_ID, {
        draft_id: draft.id,
        event: "send",
      });
      expect(outcome.status).toBe(200);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

/* -------------------------------------------------------------------------- */
/* approved + edit → draft                                                    */
/* -------------------------------------------------------------------------- */

describe("applyTransition — edit (no body)", () => {
  it("approved + edit → draft, body unchanged, sent_at null (Req 4.6)", async () => {
    const { repo, draft } = await seedApprovedDraft();
    const originalBody = draft.body;

    const outcome = await applyTransition(repo, USER_ID, {
      draft_id: draft.id,
      event: "edit",
    });

    expect(outcome.status).toBe(200);
    if (!("draft" in outcome.body)) throw new Error("expected a draft body");
    expect(outcome.body.draft.state).toBe("draft");
    expect(outcome.body.draft.sent_at).toBeNull();
    expect(outcome.body.draft.body).toBe(originalBody);

    const stored = await repo.getDraft(USER_ID, draft.id);
    expect(stored?.state).toBe("draft");
    expect(stored?.body).toBe(originalBody);
  });
});

/* -------------------------------------------------------------------------- */
/* discard (from draft and from approved) deletes the row, never sends        */
/* -------------------------------------------------------------------------- */

describe("applyTransition — discard", () => {
  it("draft + discard deletes the row and acknowledges { discarded: true } (Req 4.4, 6.6)", async () => {
    const { repo, draft } = await seedDraft();

    const outcome = await applyTransition(repo, USER_ID, {
      draft_id: draft.id,
      event: "discard",
    });

    expect(outcome.status).toBe(200);
    expect(outcome.body).toEqual({ discarded: true });

    // The row is gone — the draft contents are never sent. (Req 4.5)
    expect(await repo.getDraft(USER_ID, draft.id)).toBeNull();
  });

  it("approved + discard deletes the row and acknowledges { discarded: true } (Req 4.5, 6.6)", async () => {
    const { repo, draft } = await seedApprovedDraft();

    const outcome = await applyTransition(repo, USER_ID, {
      draft_id: draft.id,
      event: "discard",
    });

    expect(outcome.status).toBe(200);
    expect(outcome.body).toEqual({ discarded: true });
    expect(await repo.getDraft(USER_ID, draft.id)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* draft + send is a no-op                                                    */
/* -------------------------------------------------------------------------- */

describe("applyTransition — draft + send (no-op)", () => {
  it("keeps state 'draft' and sent_at null (Req 4.7, 5.3)", async () => {
    const { repo, draft } = await seedDraft();

    const outcome = await applyTransition(repo, USER_ID, {
      draft_id: draft.id,
      event: "send",
    });

    expect(outcome.status).toBe(200);
    if (!("draft" in outcome.body)) throw new Error("expected a draft body");
    expect(outcome.body.draft.state).toBe("draft");
    expect(outcome.body.draft.sent_at).toBeNull();

    const stored = await repo.getDraft(USER_ID, draft.id);
    expect(stored?.state).toBe("draft");
    expect(stored?.sentAt).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* invalid event → 400                                                        */
/* -------------------------------------------------------------------------- */

describe("applyTransition — invalid event", () => {
  it("yields 400 for an unrecognised event", async () => {
    const { repo, draft } = await seedDraft();

    const outcome = await applyTransition(repo, USER_ID, {
      draft_id: draft.id,
      event: "nonsense",
    } as ApplyTransitionBody);

    expect(outcome.status).toBe(400);

    // The draft is untouched by a rejected event.
    const stored = await repo.getDraft(USER_ID, draft.id);
    expect(stored?.state).toBe("draft");
  });
});

/* -------------------------------------------------------------------------- */
/* a sent_at record failure retains the prior state, sent_at null, errors 500 */
/* -------------------------------------------------------------------------- */

/**
 * A repository that behaves like `InMemoryDraftRepository` but throws from
 * `updateDraft` whenever a Draft is being moved to the `sent` state — i.e. the
 * simulated `sent_at` record fails. Every other operation delegates to the real
 * in-memory store, so the draft's prior state is preserved.
 */
class SendFailingDraftRepository implements DraftRepository {
  constructor(private readonly inner: InMemoryDraftRepository) {}

  createDraft(userId: string, draft: Parameters<DraftRepository["createDraft"]>[1]) {
    return this.inner.createDraft(userId, draft);
  }

  getDraft(userId: string, draftId: string) {
    return this.inner.getDraft(userId, draftId);
  }

  updateDraft(userId: string, draftId: string, patch: DraftPatch) {
    if (patch.state === "sent") {
      throw new Error("simulated sent_at record failure");
    }
    return this.inner.updateDraft(userId, draftId, patch);
  }

  deleteDraft(userId: string, draftId: string) {
    return this.inner.deleteDraft(userId, draftId);
  }

  deleteAllDrafts(userId: string) {
    return this.inner.deleteAllDrafts(userId);
  }
}

describe("applyTransition — sent_at record failure", () => {
  it("retains the prior (approved) state with sent_at null and errors 500 (Req 5.4)", async () => {
    const inner = new InMemoryDraftRepository();
    const draft = await inner.createDraft(USER_ID, {
      inboxMessageId: "m1",
      body: "Thursday at 9:40 works for me. See you then. Maya",
    });
    // Move it into `approved` on the real store before wrapping with the failing repo.
    await inner.updateDraft(USER_ID, draft.id, { state: "approved", sentAt: null });

    const repo = new SendFailingDraftRepository(inner);

    const outcome = await applyTransition(repo, USER_ID, {
      draft_id: draft.id,
      event: "send",
    });

    expect(outcome.status).toBe(500);

    // The prior state is retained and sent_at stays null — nothing was sent. (Req 5.4)
    const stored = await inner.getDraft(USER_ID, draft.id);
    expect(stored?.state).toBe("approved");
    expect(stored?.sentAt).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* edit WITH a body (from draft and from approved) stores the body as written */
/* -------------------------------------------------------------------------- */

describe("applyTransition — edit with a body", () => {
  const EDITED = "Thursday at 9:40 is great — thanks for confirming. Maya";

  it("draft + edit(body) stores the body as written, state 'draft', sent_at null (Req 4.11, 6.3)", async () => {
    const { repo, draft } = await seedDraft();

    const outcome = await applyTransition(repo, USER_ID, {
      draft_id: draft.id,
      event: "edit",
      body: EDITED,
    });

    expect(outcome.status).toBe(200);
    if (!("draft" in outcome.body)) throw new Error("expected a draft body");
    expect(outcome.body.draft.state).toBe("draft");
    expect(outcome.body.draft.sent_at).toBeNull();
    expect(outcome.body.draft.body).toBe(EDITED);

    const stored = await repo.getDraft(USER_ID, draft.id);
    expect(stored?.body).toBe(EDITED);
    expect(stored?.state).toBe("draft");
    expect(stored?.sentAt).toBeNull();
  });

  it("approved + edit(body) stores the body as written, state 'draft', sent_at null (Req 4.6, 4.11, 6.3)", async () => {
    const { repo, draft } = await seedApprovedDraft();

    const outcome = await applyTransition(repo, USER_ID, {
      draft_id: draft.id,
      event: "edit",
      body: EDITED,
    });

    expect(outcome.status).toBe(200);
    if (!("draft" in outcome.body)) throw new Error("expected a draft body");
    expect(outcome.body.draft.state).toBe("draft");
    expect(outcome.body.draft.sent_at).toBeNull();
    expect(outcome.body.draft.body).toBe(EDITED);

    const stored = await repo.getDraft(USER_ID, draft.id);
    expect(stored?.body).toBe(EDITED);
    expect(stored?.state).toBe("draft");
    expect(stored?.sentAt).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* a body with a non-edit event is a schema error (400)                       */
/* -------------------------------------------------------------------------- */

describe("TransitionRequestSchema — body only with edit", () => {
  it("rejects a body supplied with the approve event (Req 4.6)", () => {
    const parsed = TransitionRequestSchema.safeParse({
      draft_id: "d_1",
      event: "approve",
      body: "x",
    });

    expect(parsed.success).toBe(false);
  });

  it("accepts a body supplied with the edit event (Req 4.6)", () => {
    const parsed = TransitionRequestSchema.safeParse({
      draft_id: "d_1",
      event: "edit",
      body: "An edited reply.",
    });

    expect(parsed.success).toBe(true);
  });

  it("accepts a non-edit event without a body (Req 4.6)", () => {
    const parsed = TransitionRequestSchema.safeParse({
      draft_id: "d_1",
      event: "approve",
    });

    expect(parsed.success).toBe(true);
  });
});
