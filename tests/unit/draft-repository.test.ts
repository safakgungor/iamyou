// Feature: assistant-tasks, Task 4.2: unit tests for `InMemoryDraftRepository`.
//
// These tests exercise the in-memory `DraftRepository` in
// `lib/db/draft-repository.ts` — the implementation injected by the route unit
// tests and the extended "delete leaves nothing" property P4. They prove that:
//   - `createDraft` yields a row in the `draft` state with `sentAt` null
//     (Req 3.5, 5.3);
//   - `getDraft`/`updateDraft`/`deleteDraft` are scoped to `userId`, so one
//     user can neither see nor modify another user's drafts (Req 6.3, 6.6);
//   - every method returns COPIES, so mutating a returned row cannot change
//     stored state (Req 6.3);
//   - `deleteDraft` removes only the caller's own row (Req 6.6);
//   - `updateDraft` with `patch.body` replaces the stored body and without it
//     leaves the body unchanged while still applying state/sentAt (Req 4.6);
//   - `deleteAllDrafts(userId)` empties only the caller's drafts, leaving other
//     users' drafts intact (Req 6.6).
//
// Validates: Requirements 3.5, 4.6, 5.3, 6.3, 6.6
import { describe, expect, it } from "vitest";

import {
  InMemoryDraftRepository,
  type NewDraft,
} from "@/lib/db/draft-repository";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const USER_ID = "user-1";
const OTHER_USER_ID = "user-2";

/** A valid NewDraft input the repository can create a row from. */
function makeNewDraft(overrides: Partial<NewDraft> = {}): NewDraft {
  return {
    inboxMessageId: "m1",
    body: "Thursday at 9:40 works for me. See you then. Maya",
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* createDraft                                                                */
/* -------------------------------------------------------------------------- */

describe("createDraft", () => {
  it("yields a row in the 'draft' state with sentAt null (Req 3.5, 5.3)", async () => {
    const repo = new InMemoryDraftRepository();

    const created = await repo.createDraft(USER_ID, makeNewDraft());

    expect(created.state).toBe("draft");
    expect(created.sentAt).toBeNull();
    expect(created.inboxMessageId).toBe("m1");
    expect(created.body).toBe(
      "Thursday at 9:40 works for me. See you then. Maya",
    );
    expect(created.id).toBeTruthy();
    expect(created.createdAt).toBeTruthy();
  });

  it("assigns distinct ids to successive drafts", async () => {
    const repo = new InMemoryDraftRepository();

    const first = await repo.createDraft(USER_ID, makeNewDraft());
    const second = await repo.createDraft(USER_ID, makeNewDraft());

    expect(first.id).not.toBe(second.id);
  });
});

/* -------------------------------------------------------------------------- */
/* userId scoping                                                             */
/* -------------------------------------------------------------------------- */

describe("userId scoping", () => {
  it("getDraft returns null for a draft owned by a different user (Req 6.3)", async () => {
    const repo = new InMemoryDraftRepository();
    const owned = await repo.createDraft(USER_ID, makeNewDraft());

    // The owner can read it...
    expect(await repo.getDraft(USER_ID, owned.id)).not.toBeNull();
    // ...but a different user cannot see it.
    expect(await repo.getDraft(OTHER_USER_ID, owned.id)).toBeNull();
  });

  it("updateDraft on another user's draft throws and leaves it unchanged (Req 6.3)", async () => {
    const repo = new InMemoryDraftRepository();
    const owned = await repo.createDraft(USER_ID, makeNewDraft());

    await expect(
      repo.updateDraft(OTHER_USER_ID, owned.id, {
        state: "approved",
        sentAt: null,
      }),
    ).rejects.toThrow();

    // The owner's draft is untouched.
    const after = await repo.getDraft(USER_ID, owned.id);
    expect(after?.state).toBe("draft");
  });

  it("deleteDraft by a different user does not remove the owner's draft (Req 6.6)", async () => {
    const repo = new InMemoryDraftRepository();
    const owned = await repo.createDraft(USER_ID, makeNewDraft());

    // A non-owner's delete is a no-op against the owner's bucket.
    await repo.deleteDraft(OTHER_USER_ID, owned.id);

    expect(await repo.getDraft(USER_ID, owned.id)).not.toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* returned rows are copies                                                   */
/* -------------------------------------------------------------------------- */

describe("returned rows are copies", () => {
  it("mutating a createDraft result does not affect stored state (Req 6.3)", async () => {
    const repo = new InMemoryDraftRepository();
    const created = await repo.createDraft(USER_ID, makeNewDraft());

    created.body = "MUTATED";
    created.state = "sent";
    created.sentAt = "2025-01-01T00:00:00.000Z";

    const stored = await repo.getDraft(USER_ID, created.id);
    expect(stored?.body).toBe(
      "Thursday at 9:40 works for me. See you then. Maya",
    );
    expect(stored?.state).toBe("draft");
    expect(stored?.sentAt).toBeNull();
  });

  it("mutating a getDraft result does not affect stored state (Req 6.3)", async () => {
    const repo = new InMemoryDraftRepository();
    const created = await repo.createDraft(USER_ID, makeNewDraft());

    const first = await repo.getDraft(USER_ID, created.id);
    first!.body = "MUTATED";

    const second = await repo.getDraft(USER_ID, created.id);
    expect(second?.body).toBe(
      "Thursday at 9:40 works for me. See you then. Maya",
    );
  });

  it("mutating an updateDraft result does not affect stored state (Req 6.3)", async () => {
    const repo = new InMemoryDraftRepository();
    const created = await repo.createDraft(USER_ID, makeNewDraft());

    const updated = await repo.updateDraft(USER_ID, created.id, {
      state: "approved",
      sentAt: null,
    });
    updated.body = "MUTATED";

    const stored = await repo.getDraft(USER_ID, created.id);
    expect(stored?.body).toBe(
      "Thursday at 9:40 works for me. See you then. Maya",
    );
    expect(stored?.state).toBe("approved");
  });
});

/* -------------------------------------------------------------------------- */
/* deleteDraft                                                                */
/* -------------------------------------------------------------------------- */

describe("deleteDraft", () => {
  it("removes only the caller's targeted row (Req 6.6)", async () => {
    const repo = new InMemoryDraftRepository();
    const target = await repo.createDraft(USER_ID, makeNewDraft());
    const sibling = await repo.createDraft(
      USER_ID,
      makeNewDraft({ inboxMessageId: "m2" }),
    );

    await repo.deleteDraft(USER_ID, target.id);

    expect(await repo.getDraft(USER_ID, target.id)).toBeNull();
    // The caller's other draft survives.
    expect(await repo.getDraft(USER_ID, sibling.id)).not.toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* updateDraft body handling                                                  */
/* -------------------------------------------------------------------------- */

describe("updateDraft body handling", () => {
  it("replaces the stored body when patch.body is present (Req 4.6)", async () => {
    const repo = new InMemoryDraftRepository();
    const created = await repo.createDraft(USER_ID, makeNewDraft());

    const updated = await repo.updateDraft(USER_ID, created.id, {
      state: "draft",
      sentAt: null,
      body: "An edited reply written by the user.",
    });

    expect(updated.body).toBe("An edited reply written by the user.");
    const stored = await repo.getDraft(USER_ID, created.id);
    expect(stored?.body).toBe("An edited reply written by the user.");
  });

  it("leaves the body unchanged when patch.body is omitted but still applies state/sentAt (Req 4.6, 5.3)", async () => {
    const repo = new InMemoryDraftRepository();
    const created = await repo.createDraft(USER_ID, makeNewDraft());
    const originalBody = created.body;
    const sentAt = "2025-01-01T12:00:00.000Z";

    const updated = await repo.updateDraft(USER_ID, created.id, {
      state: "sent",
      sentAt,
    });

    // Body untouched...
    expect(updated.body).toBe(originalBody);
    // ...state and sentAt applied.
    expect(updated.state).toBe("sent");
    expect(updated.sentAt).toBe(sentAt);

    const stored = await repo.getDraft(USER_ID, created.id);
    expect(stored?.body).toBe(originalBody);
    expect(stored?.state).toBe("sent");
    expect(stored?.sentAt).toBe(sentAt);
  });
});

/* -------------------------------------------------------------------------- */
/* deleteAllDrafts                                                            */
/* -------------------------------------------------------------------------- */

describe("deleteAllDrafts", () => {
  it("empties only the caller's drafts, leaving other users' drafts intact (Req 6.6)", async () => {
    const repo = new InMemoryDraftRepository();
    const callerA = await repo.createDraft(USER_ID, makeNewDraft());
    const callerB = await repo.createDraft(
      USER_ID,
      makeNewDraft({ inboxMessageId: "m2" }),
    );
    const other = await repo.createDraft(
      OTHER_USER_ID,
      makeNewDraft({ inboxMessageId: "m3" }),
    );

    await repo.deleteAllDrafts(USER_ID);

    // The caller owns nothing...
    expect(await repo.getDraft(USER_ID, callerA.id)).toBeNull();
    expect(await repo.getDraft(USER_ID, callerB.id)).toBeNull();
    // ...while the other user's draft is intact.
    expect(await repo.getDraft(OTHER_USER_ID, other.id)).not.toBeNull();
  });
});
