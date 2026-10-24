// Feature: assistant-tasks, Task 9.2: unit tests for the draft route core.
//
// These tests exercise the exported `createDraft(drafts, vault, claude, userId,
// body)` in `app/api/assistant/draft/route.ts`. Because `createDraft` takes its
// collaborators as arguments, we drive it with `InMemoryDraftRepository`,
// `InMemoryVaultRepository`, and a hand-rolled mock `DraftClaude` whose
// `draftReply` returns a canned `DraftReplyResult` and records the arguments it
// received. No HTTP, auth, or network is involved; the route reads the REAL
// synthetic inbox via `loadInbox()`, so we use a real message id ('m1', the
// "Dr. Lee's office, Valley Family Medicine" appointment) from
// data/synthetic/maya/inbox.json.
//
// Covered behaviours (Req 3.3, 3.4, 3.5, 3.7, 7.5):
//   - a safe draft is stored with state='draft' and sent_at=null, outcome 200
//     { draft } (Req 3.5);
//   - at most 5 style examples are passed to draftReply and the MOST RECENT (by
//     createdAt) are chosen (Req 3.3);
//   - zero style examples still drafts: an empty styleExamples list, 200 (Req 3.4);
//   - an unknown inbox_message_id yields 404 and creates no Draft (Req 3.1, 3.2);
//   - a Claude failure result (timeout/refusal/unsafe) yields 502 and creates no
//     Draft (Req 3.7, 7.5).
//
// Validates: Requirements 3.3, 3.4, 3.5, 3.7, 7.5
import { beforeEach, describe, expect, it } from "vitest";

import {
  createDraft,
  type CreateDraftBody,
  type DraftClaude,
} from "@/app/api/assistant/draft/route";
import { InMemoryDraftRepository } from "@/lib/db/draft-repository";
import { InMemoryVaultRepository } from "@/lib/db/vault-repository";
import type { DraftReplyResult } from "@/lib/claude";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const USER_ID = "user-1";

// A real message id from data/synthetic/maya/inbox.json — the Dr. Lee's office
// appointment reminder.
const REAL_MESSAGE_ID = "m1";

/** The parsed request body createDraft takes. */
function body(inboxMessageId: string): CreateDraftBody {
  return { inbox_message_id: inboxMessageId };
}

/**
 * A spying mock implementation of `DraftClaude`. It returns a canned
 * `DraftReplyResult` and records the single `draftReply` input it received so
 * tests can assert over the `styleExamples` and `message` arguments.
 */
function makeClaude(result: DraftReplyResult): DraftClaude & {
  calls: Array<{ message: unknown; styleExamples: string[] }>;
} {
  const calls: Array<{ message: unknown; styleExamples: string[] }> = [];
  return {
    calls,
    async draftReply(input) {
      calls.push({ message: input.message, styleExamples: input.styleExamples });
      return result;
    },
  };
}

/** A safe draft result the mock can hand back. */
const SAFE_RESULT: DraftReplyResult = {
  ok: true,
  text: "Thursday at 9:40 works for me. See you then. Maya",
};

/* -------------------------------------------------------------------------- */
/* Shared repos                                                               */
/* -------------------------------------------------------------------------- */

let drafts: InMemoryDraftRepository;
let vault: InMemoryVaultRepository;

beforeEach(() => {
  drafts = new InMemoryDraftRepository();
  vault = new InMemoryVaultRepository();
});

/* -------------------------------------------------------------------------- */
/* Safe draft → stored in 'draft' with sent_at null, 200 { draft }            */
/* -------------------------------------------------------------------------- */

describe("createDraft — safe draft", () => {
  it("stores a Draft in state='draft' with sent_at=null and returns 200 { draft } (Req 3.5)", async () => {
    const claude = makeClaude(SAFE_RESULT);

    const outcome = await createDraft(
      drafts,
      vault,
      claude,
      USER_ID,
      body(REAL_MESSAGE_ID),
    );

    expect(outcome.status).toBe(200);
    if (outcome.status !== 200) throw new Error("expected 200");

    const draft = outcome.body.draft;
    expect(draft.state).toBe("draft");
    expect(draft.sent_at).toBeNull();
    expect(draft.inbox_message_id).toBe(REAL_MESSAGE_ID);
    expect(draft.body).toBe(SAFE_RESULT.ok ? SAFE_RESULT.text : "");
    expect(draft.id).toBeTruthy();

    // The Draft was actually persisted under the caller in the 'draft' state.
    const stored = await drafts.getDraft(USER_ID, draft.id);
    expect(stored).not.toBeNull();
    expect(stored?.state).toBe("draft");
    expect(stored?.sentAt).toBeNull();
    expect(stored?.body).toBe(draft.body);
  });
});

/* -------------------------------------------------------------------------- */
/* Style examples: at most 5, most recent by createdAt                        */
/* -------------------------------------------------------------------------- */

describe("createDraft — style example selection", () => {
  it("passes at most 5 style examples and chooses the MOST RECENT by createdAt (Req 3.3)", async () => {
    const claude = makeClaude(SAFE_RESULT);

    // Seed 7 style_example entries with distinct, increasing createdAt
    // timestamps. Their text encodes the day so we can assert ordering.
    //   e01 (oldest) … e07 (newest)
    for (let day = 1; day <= 7; day += 1) {
      await vault.addVaultEntry(USER_ID, {
        kind: "style_example",
        text: `style-${String(day).padStart(2, "0")}`,
        createdAt: `2025-01-${String(day).padStart(2, "0")}T00:00:00.000Z`,
      });
    }

    // Seed some non-style entries that must be ignored by the filter.
    await vault.addVaultEntry(USER_ID, {
      kind: "story",
      text: "a story that must not be selected",
      createdAt: "2025-02-01T00:00:00.000Z",
    });
    await vault.addVaultEntry(USER_ID, {
      kind: "opinion",
      text: "an opinion that must not be selected",
      createdAt: "2025-02-02T00:00:00.000Z",
    });

    const outcome = await createDraft(
      drafts,
      vault,
      claude,
      USER_ID,
      body(REAL_MESSAGE_ID),
    );

    expect(outcome.status).toBe(200);
    expect(claude.calls).toHaveLength(1);

    const passed = claude.calls[0].styleExamples;

    // At most 5 examples are carried. (Req 3.3)
    expect(passed).toHaveLength(5);

    // They are the 5 MOST RECENT by createdAt: days 7,6,5,4,3 → style-07..03.
    expect(passed).toEqual([
      "style-07",
      "style-06",
      "style-05",
      "style-04",
      "style-03",
    ]);

    // Non-style entries are never included.
    expect(passed).not.toContain("a story that must not be selected");
    expect(passed).not.toContain("an opinion that must not be selected");
  });
});

/* -------------------------------------------------------------------------- */
/* Zero style examples still drafts                                           */
/* -------------------------------------------------------------------------- */

describe("createDraft — no style examples", () => {
  it("drafts with an empty styleExamples list when the caller has no style_example entries (Req 3.4)", async () => {
    const claude = makeClaude(SAFE_RESULT);

    // The vault has non-style entries but zero style_example entries.
    await vault.addVaultEntry(USER_ID, {
      kind: "conversation",
      text: "not a style example",
      createdAt: "2025-01-01T00:00:00.000Z",
    });

    const outcome = await createDraft(
      drafts,
      vault,
      claude,
      USER_ID,
      body(REAL_MESSAGE_ID),
    );

    expect(outcome.status).toBe(200);
    expect(claude.calls).toHaveLength(1);
    // An empty style-examples list is passed, and the Draft is still created.
    expect(claude.calls[0].styleExamples).toEqual([]);

    if (outcome.status !== 200) throw new Error("expected 200");
    expect(outcome.body.draft.state).toBe("draft");
  });
});

/* -------------------------------------------------------------------------- */
/* Unknown inbox_message_id → 404, no Draft                                   */
/* -------------------------------------------------------------------------- */

describe("createDraft — unknown message", () => {
  it("returns 404 and creates no Draft for an unknown inbox_message_id (Req 3.1, 3.2)", async () => {
    const claude = makeClaude(SAFE_RESULT);

    const outcome = await createDraft(
      drafts,
      vault,
      claude,
      USER_ID,
      body("does-not-exist"),
    );

    expect(outcome.status).toBe(404);

    // Claude was never reached and no Draft was stored.
    expect(claude.calls).toHaveLength(0);
    const owned = await drafts.getDraft(USER_ID, "d_1");
    expect(owned).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Claude failure (timeout / refusal / unsafe) → 502, no Draft                */
/* -------------------------------------------------------------------------- */

describe("createDraft — Claude failure", () => {
  const failures = ["timeout", "refusal", "unsafe"] as const;

  for (const reason of failures) {
    it(`returns 502 and creates no Draft on a '${reason}' result (Req 3.7, 7.5)`, async () => {
      const claude = makeClaude({ ok: false, reason });

      const outcome = await createDraft(
        drafts,
        vault,
        claude,
        USER_ID,
        body(REAL_MESSAGE_ID),
      );

      expect(outcome.status).toBe(502);
      if (outcome.status !== 502) throw new Error("expected 502");
      expect(outcome.body.error).toBe("draft_generation_failed");

      // Claude was reached once, but no Draft was ever stored.
      expect(claude.calls).toHaveLength(1);
      expect(await drafts.getDraft(USER_ID, "d_1")).toBeNull();
    });
  }
});
