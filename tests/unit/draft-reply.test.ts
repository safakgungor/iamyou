// Feature: assistant-tasks, Task 7.3: unit tests for `draftReply` with a mocked
// Anthropic client.
//
// `draftReply(input, client?)` accepts an injectable client as its second
// argument, so these tests pass a fake client whose `messages.create` returns
// canned SDK-shaped results. The real Anthropic API is never called.
//
// The assertions cover every branch of draftReply's safety flow (Req 3.7, 7.4,
// 7.5):
//   - a safe first draft                      → { ok: true, text }
//   - an unsafe first draft the retry fixes   → { ok: true, text } (two calls)
//   - two unsafe drafts                        → { ok: false, reason: 'unsafe' }
//   - a refusal (stop_reason === 'refusal')   → { ok: false, reason: 'refusal' }
//   - a slow call (> 30s)                      → { ok: false, reason: 'timeout' }
//
// "Unsafe" text is produced by introducing a HEALTH_TERMS word (e.g.
// "diagnosis") that is absent from the source message body; validateDraftSafety
// then rejects it. "Safe" text is a plain appointment confirmation.
//
// Validates: Requirements 3.7, 7.4, 7.5
import { afterEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";

import { draftReply } from "@/lib/claude";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

// The source message being replied to. Its body has no HEALTH_TERMS words, so a
// draft that adds "diagnosis" is unsafe, while a plain confirmation is safe.
const MESSAGE = {
  from: "Dr. Lee's office, Valley Family Medicine",
  subject: "Your appointment on Thursday",
  body: "Hi Maya, this is a reminder that you have an appointment with Dr. Lee on Thursday at 9:40 am. Please reply to confirm, or let us know if you need to reschedule.",
};

const INPUT = { message: MESSAGE, styleExamples: ["Thanks! See you then. Maya"] };

// A safe reply: a plain confirmation that adds no health content. Scheduling
// words (appointment/confirm/doctor) are never treated as health terms.
const SAFE_TEXT = "Thursday at 9:40 works for me. See you then. Maya";

// An unsafe reply: it introduces "diagnosis", a HEALTH_TERMS word absent from
// the source body, so validateDraftSafety rejects it.
const UNSAFE_TEXT = "Thursday works. Also, I think this is about my diagnosis. Maya";

/* -------------------------------------------------------------------------- */
/* Mock client                                                                */
/* -------------------------------------------------------------------------- */

// draftReply reads exactly this shape off messages.create:
//   { stop_reason, content: [{ type: 'text', text }] }
// The mock mimics only those fields and is cast to Anthropic so it slots into
// the injectable `client` parameter without pulling in the full SDK surface.

/** A text-block content array as the SDK returns for messages.create. */
function textContent(text: string) {
  return [{ type: "text", text }];
}

type CreateResult = { stop_reason: string; content: unknown };

/**
 * Builds a mock Anthropic client whose `messages.create` returns the supplied
 * results in order: the Nth call returns `results[N-1]` (the last entry repeats
 * if there are more calls than results). The `create` factory may return a
 * value or a promise, letting a test delay a response for the timeout case. The
 * request objects are recorded so call count can be asserted.
 */
function makeClient(
  results: Array<CreateResult | Promise<CreateResult>>,
): { client: Anthropic; calls: unknown[] } {
  const calls: unknown[] = [];

  const client = {
    messages: {
      create: (req: unknown) => {
        const index = calls.length;
        calls.push(req);
        const result = results[Math.min(index, results.length - 1)];
        return Promise.resolve(result);
      },
    },
  } as unknown as Anthropic;

  return { client, calls };
}

/* -------------------------------------------------------------------------- */
/* Tests                                                                      */
/* -------------------------------------------------------------------------- */

afterEach(() => {
  vi.useRealTimers();
});

describe("draftReply", () => {
  it("returns { ok: true } for a safe first draft", async () => {
    const { client, calls } = makeClient([
      { stop_reason: "end_turn", content: textContent(SAFE_TEXT) },
    ]);

    const result = await draftReply(INPUT, client);

    expect(result).toEqual({ ok: true, text: SAFE_TEXT });
    // The safe first draft needs no retry: exactly one Claude call.
    expect(calls).toHaveLength(1);
  });

  it("returns { ok: true } when an unsafe first draft is fixed by the retry", async () => {
    const { client, calls } = makeClient([
      // Call 1: unsafe (introduces "diagnosis") → fails validation → retry.
      { stop_reason: "end_turn", content: textContent(UNSAFE_TEXT) },
      // Call 2: safe → passes validation → returned.
      { stop_reason: "end_turn", content: textContent(SAFE_TEXT) },
    ]);

    const result = await draftReply(INPUT, client);

    expect(result).toEqual({ ok: true, text: SAFE_TEXT });
    // One retry means exactly two Claude calls.
    expect(calls).toHaveLength(2);
  });

  it("returns { ok: false, reason: 'unsafe' } when both drafts are unsafe", async () => {
    const { client, calls } = makeClient([
      { stop_reason: "end_turn", content: textContent(UNSAFE_TEXT) },
      { stop_reason: "end_turn", content: textContent(UNSAFE_TEXT) },
    ]);

    const result = await draftReply(INPUT, client);

    expect(result).toEqual({ ok: false, reason: "unsafe" });
    // The first draft plus a single retry: no third attempt.
    expect(calls).toHaveLength(2);
  });

  it("returns { ok: false, reason: 'refusal' } on a refusal", async () => {
    const { client, calls } = makeClient([
      {
        stop_reason: "refusal",
        // Content present but must be ignored once stop_reason is refusal.
        content: textContent("should never be read"),
      },
    ]);

    const result = await draftReply(INPUT, client);

    expect(result).toEqual({ ok: false, reason: "refusal" });
    // Refusal is detected on the first call; no retry.
    expect(calls).toHaveLength(1);
  });

  it("returns { ok: false, reason: 'timeout' } when the call is too slow", async () => {
    vi.useFakeTimers();

    // A call that never resolves on its own; only the 30s timeout settles it.
    const neverResolves = new Promise<CreateResult>(() => {});
    const { client } = makeClient([neverResolves]);

    const resultPromise = draftReply(INPUT, client);

    // Advance past the 30_000ms timeout constant so the internal timer fires.
    await vi.advanceTimersByTimeAsync(30_000);

    const result = await resultPromise;
    expect(result).toEqual({ ok: false, reason: "timeout" });
  });
});
