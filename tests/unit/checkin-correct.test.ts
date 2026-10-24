// Feature: twin-loop, Task 14.2: unit tests for POST /api/checkin/correct.
//
// These tests exercise the HTTP- and auth-free `submitCorrection` helper
// exported from the route against an in-memory VaultRepository and a MOCKED
// Anthropic client. The real Supabase and Anthropic APIs are never called.
//
// `submitCorrection` calls `screenText(text, claude)` from lib/claude, which in
// turn calls `claude.messages.parse(...)`. Rather than mock the module, we drive
// `screenText`'s branches by injecting a mock Anthropic client whose
// `messages.parse` returns controlled, SDK-shaped results — the same approach
// used by the Claude-layer unit tests (task 10.4), keeping the test
// deterministic and free of the network.
//
// Covered behaviour (design "POST /api/checkin/correct"):
//   - Clean text (screen ⇒ crisis:false, genetics_question:false) ⇒ a
//     vault_entries row with kind 'correction' is stored and the body is
//     { kind: 'stored' }.                                       (Req 7.1, 7.3)
//   - screen ⇒ crisis ⇒ stores NOTHING and body
//     { kind: 'support', message: SUPPORT_MESSAGE }.                 (Req 9.2)
//   - screen ⇒ genetics_question ⇒ stores NOTHING and body
//     { kind: 'counselor', message: COUNSELOR_MESSAGE }.             (Req 9.4)
//   - Over-280-char text is rejected (a 400) at the schema level BEFORE any
//     model call: CheckInCorrectRequestSchema.safeParse fails.       (Req 7.2)
//
// Validates: Requirements 7.1, 7.2, 7.3, 9.2, 9.4
import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";

import { submitCorrection } from "@/app/api/checkin/correct/route";
import { CheckInCorrectRequestSchema } from "@/lib/claude/schemas";
import { SUPPORT_MESSAGE, COUNSELOR_MESSAGE } from "@/lib/safety";
import { InMemoryVaultRepository } from "@/lib/db/vault-repository";

const USER_ID = "anon-user-1";
const PREDICTION_ID = "p_1";

/* -------------------------------------------------------------------------- */
/* Mock client                                                                */
/* -------------------------------------------------------------------------- */

// `screenText` reads exactly this shape off the SDK:
//   messages.parse → { stop_reason, parsed_output }
// The mock mimics only that one method, returning a canned screening result, and
// is cast to Anthropic so it slots into submitCorrection's `claude` parameter
// without pulling in the whole SDK surface.

/**
 * Builds a mock Anthropic client whose `messages.parse` resolves to a screening
 * with the given flags and an `end_turn` stop reason (so `screenText` returns
 * `{ storeNothing: false, screening }`). `calls` records each parse request so a
 * test can assert the model was (or was not) reached.
 */
function makeScreeningClient(screening: {
  crisis: boolean;
  genetics_question: boolean;
}): { client: Anthropic; calls: unknown[] } {
  const calls: unknown[] = [];
  const client = {
    messages: {
      parse: async (req: unknown) => {
        calls.push(req);
        return { stop_reason: "end_turn", parsed_output: screening };
      },
    },
  } as unknown as Anthropic;
  return { client, calls };
}

/* -------------------------------------------------------------------------- */
/* Clean text ⇒ stored                                                        */
/* -------------------------------------------------------------------------- */

describe("submitCorrection — clean text", () => {
  it("stores a correction vault_entries row and returns { kind: 'stored' }", async () => {
    const repo = new InMemoryVaultRepository();
    const { client, calls } = makeScreeningClient({
      crisis: false,
      genetics_question: false,
    });

    const result = await submitCorrection(repo, client, USER_ID, {
      prediction_id: PREDICTION_ID,
      text: "Actually, I was feeling hopeful, not anxious.",
    });

    // Body reports the correction as stored (Req 7.3).
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ kind: "stored" });

    // A single vault entry of kind 'correction' now exists (Req 7.1, 7.3),
    // and it carries the user's correction text.
    const entries = await repo.listVaultEntries(USER_ID);
    const corrections = entries.filter((e) => e.kind === "correction");
    expect(corrections).toHaveLength(1);
    expect(corrections[0].text).toContain(
      "Actually, I was feeling hopeful, not anxious.",
    );

    // The clean path screens the text exactly once.
    expect(calls).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Crisis ⇒ support, store nothing                                            */
/* -------------------------------------------------------------------------- */

describe("submitCorrection — crisis", () => {
  it("stores nothing and returns the support message", async () => {
    const repo = new InMemoryVaultRepository();
    const { client } = makeScreeningClient({
      crisis: true,
      genetics_question: false,
    });

    const result = await submitCorrection(repo, client, USER_ID, {
      prediction_id: PREDICTION_ID,
      text: "something that triggers the crisis screen",
    });

    // Support result with the exact SUPPORT_MESSAGE (Req 9.2).
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ kind: "support", message: SUPPORT_MESSAGE });

    // Nothing was stored (Req 9.2).
    const entries = await repo.listVaultEntries(USER_ID);
    expect(entries).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Genetics question ⇒ counselor, store nothing                               */
/* -------------------------------------------------------------------------- */

describe("submitCorrection — genetics question", () => {
  it("stores nothing and returns the counselor message", async () => {
    const repo = new InMemoryVaultRepository();
    const { client } = makeScreeningClient({
      crisis: false,
      genetics_question: true,
    });

    const result = await submitCorrection(repo, client, USER_ID, {
      prediction_id: PREDICTION_ID,
      text: "What does my BRCA result actually mean?",
    });

    // Counselor result with the exact COUNSELOR_MESSAGE (Req 9.4).
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      kind: "counselor",
      message: COUNSELOR_MESSAGE,
    });

    // Nothing was stored (Req 9.4).
    const entries = await repo.listVaultEntries(USER_ID);
    expect(entries).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Over-280 chars ⇒ 400 at the schema level                                   */
/* -------------------------------------------------------------------------- */

describe("CheckInCorrectRequestSchema — length cap", () => {
  it("rejects text longer than 280 characters (the route's 400, before any model call)", () => {
    // 281 characters — one over the cap enforced by .max(280) (Req 7.2).
    const tooLong = "a".repeat(281);

    const parsed = CheckInCorrectRequestSchema.safeParse({
      prediction_id: PREDICTION_ID,
      text: tooLong,
    });

    expect(parsed.success).toBe(false);
  });

  it("accepts text of exactly 280 characters", () => {
    const atCap = "a".repeat(280);

    const parsed = CheckInCorrectRequestSchema.safeParse({
      prediction_id: PREDICTION_ID,
      text: atCap,
    });

    expect(parsed.success).toBe(true);
  });
});
