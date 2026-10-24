// Feature: twin-loop, Task 10.4: unit tests for the server-only Claude layer.
//
// These tests exercise the four Claude functions (predictAnswer, gradeAnswer,
// spokenReply, screenText) with a MOCKED Anthropic client injected via the
// optional `client` parameter each function accepts. The real Anthropic API is
// never called.
//
// The safety-path assertions are the point of this file: every function checks
// `stop_reason === 'refusal'` before reading content and returns a fail-safe.
//   - gradeAnswer refusal  → crisis fail-safe (crisis: true, score 0, no match)
//   - screenText refusal   → { storeNothing: true }
//   - spokenReply refusal  → SPOKEN_REPLY_FALLBACK (the fixed gentle sentence)
// Each function is also exercised on a happy path so the mock wiring is proven
// in both directions.
//
// Validates: Requirements 6.1, 6.7, 9.1, 9.2
import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";

import {
  gradeAnswer,
  predictAnswer,
  screenText,
  spokenReply,
} from "@/lib/claude";
import { SPOKEN_REPLY_FALLBACK } from "@/lib/claude/prompts";
import type { PredictionRequest } from "@/lib/prediction";

/* -------------------------------------------------------------------------- */
/* Mock client builders                                                       */
/* -------------------------------------------------------------------------- */

// The functions read exactly these shapes off the SDK:
//   messages.create        → { stop_reason, content: [{ type: 'text', text }] }
//   messages.parse         → { stop_reason, parsed_output }
//   beta.messages.create   → { stop_reason, content: [{ type: 'text', text }] }
// The mock mimics only those fields and is cast to Anthropic so it slots into
// the injectable `client` parameter without pulling in the whole SDK surface.

type CreateResult = { stop_reason: string; content: unknown };
type ParseResult = { stop_reason: string; parsed_output: unknown };

/** A text-block content array as the SDK returns for messages.create. */
function textContent(text: string) {
  return [{ type: "text", text }];
}

/**
 * Builds a mock Anthropic client. Each handler records the request it was
 * called with so wiring (system + single user message, no prefill) can be
 * asserted, and returns the canned SDK-shaped result supplied by the test.
 */
function makeClient(handlers: {
  messagesCreate?: CreateResult;
  messagesParse?: ParseResult;
  betaMessagesCreate?: CreateResult;
}): {
  client: Anthropic;
  calls: {
    messagesCreate: unknown[];
    messagesParse: unknown[];
    betaMessagesCreate: unknown[];
  };
} {
  const calls = {
    messagesCreate: [] as unknown[],
    messagesParse: [] as unknown[],
    betaMessagesCreate: [] as unknown[],
  };

  const client = {
    messages: {
      create: async (req: unknown) => {
        calls.messagesCreate.push(req);
        if (!handlers.messagesCreate) {
          throw new Error("messages.create not configured for this test");
        }
        return handlers.messagesCreate;
      },
      parse: async (req: unknown) => {
        calls.messagesParse.push(req);
        if (!handlers.messagesParse) {
          throw new Error("messages.parse not configured for this test");
        }
        return handlers.messagesParse;
      },
    },
    beta: {
      messages: {
        create: async (req: unknown) => {
          calls.betaMessagesCreate.push(req);
          if (!handlers.betaMessagesCreate) {
            throw new Error(
              "beta.messages.create not configured for this test",
            );
          }
          return handlers.betaMessagesCreate;
        },
      },
    },
  } as unknown as Anthropic;

  return { client, calls };
}

const PREDICTION_REQUEST: PredictionRequest = {
  prompt: "How are you feeling about work this week?",
  context: [{ kind: "opinion", text: "I care a lot about doing good work." }],
};

/* -------------------------------------------------------------------------- */
/* predictAnswer                                                              */
/* -------------------------------------------------------------------------- */

describe("predictAnswer", () => {
  it("returns the model's predicted text on the happy path", async () => {
    const { client, calls } = makeClient({
      messagesCreate: {
        stop_reason: "end_turn",
        content: textContent("I feel steady and focused about work."),
      },
    });

    const result = await predictAnswer(PREDICTION_REQUEST, client);

    expect(result).toBe("I feel steady and focused about work.");
    // messages.create was the endpoint used; exactly one call.
    expect(calls.messagesCreate).toHaveLength(1);
    expect(calls.messagesParse).toHaveLength(0);
  });

  it("returns an empty string on refusal without reading content", async () => {
    const { client } = makeClient({
      messagesCreate: {
        stop_reason: "refusal",
        // Content present but must be ignored once stop_reason is refusal.
        content: textContent("should never be read"),
      },
    });

    const result = await predictAnswer(PREDICTION_REQUEST, client);

    expect(result).toBe("");
  });
});

/* -------------------------------------------------------------------------- */
/* gradeAnswer                                                                */
/* -------------------------------------------------------------------------- */

describe("gradeAnswer", () => {
  it("returns the parsed grading object on the happy path", async () => {
    const grading = {
      score: 0.82,
      rationale: "The prediction captured the same stance.",
      crisis: false,
      genetics_question: false,
    };
    const { client, calls } = makeClient({
      messagesParse: { stop_reason: "end_turn", parsed_output: grading },
    });

    const result = await gradeAnswer("predicted", "real answer", client);

    expect(result).toEqual(grading);
    expect(calls.messagesParse).toHaveLength(1);
  });

  it("FAILS SAFE as crisis on refusal (crisis: true, no usable score)", async () => {
    const { client } = makeClient({
      messagesParse: {
        stop_reason: "refusal",
        parsed_output: { score: 0.99, rationale: "ignored", crisis: false, genetics_question: true },
      },
    });

    const result = await gradeAnswer("predicted", "real answer", client);

    // Matches gradingFailSafe() in index.ts: crisis true, score 0, no genetics.
    expect(result).toEqual({
      score: 0,
      rationale: "",
      crisis: true,
      genetics_question: false,
    });
  });

  it("FAILS SAFE as crisis when parsing fails", async () => {
    const { client } = makeClient({
      messagesParse: {
        stop_reason: "end_turn",
        parsed_output: { not: "a valid grading object" },
      },
    });

    const result = await gradeAnswer("predicted", "real answer", client);

    expect(result).toEqual({
      score: 0,
      rationale: "",
      crisis: true,
      genetics_question: false,
    });
  });
});

/* -------------------------------------------------------------------------- */
/* spokenReply                                                                */
/* -------------------------------------------------------------------------- */

describe("spokenReply", () => {
  const input = {
    rationale: "Close match in meaning.",
    prediction: "I feel good.",
    answer: "I feel good about it.",
  };

  it("returns the model sentence on the happy path", async () => {
    const sentence = "It sounds like you are in a good place today.";
    const { client, calls } = makeClient({
      betaMessagesCreate: {
        stop_reason: "end_turn",
        content: textContent(sentence),
      },
    });

    const result = await spokenReply(input, client);

    expect(result).toBe(sentence);
    // spokenReply uses the beta messages endpoint.
    expect(calls.betaMessagesCreate).toHaveLength(1);
  });

  it("returns SPOKEN_REPLY_FALLBACK on refusal", async () => {
    const { client } = makeClient({
      betaMessagesCreate: {
        stop_reason: "refusal",
        content: textContent("should never be read"),
      },
    });

    const result = await spokenReply(input, client);

    expect(result).toBe(SPOKEN_REPLY_FALLBACK);
  });

  it("returns SPOKEN_REPLY_FALLBACK when the model returns an empty sentence", async () => {
    const { client } = makeClient({
      betaMessagesCreate: {
        stop_reason: "end_turn",
        content: textContent("   "),
      },
    });

    const result = await spokenReply(input, client);

    expect(result).toBe(SPOKEN_REPLY_FALLBACK);
  });
});

/* -------------------------------------------------------------------------- */
/* screenText                                                                 */
/* -------------------------------------------------------------------------- */

describe("screenText", () => {
  it("returns the screening flags on the happy path", async () => {
    const screening = { crisis: false, genetics_question: true };
    const { client, calls } = makeClient({
      messagesParse: { stop_reason: "end_turn", parsed_output: screening },
    });

    const result = await screenText("What does my BRCA result mean?", client);

    expect(result).toEqual({ storeNothing: false, screening });
    expect(calls.messagesParse).toHaveLength(1);
  });

  it("FAILS SAFE as store-nothing on refusal", async () => {
    const { client } = makeClient({
      messagesParse: {
        stop_reason: "refusal",
        parsed_output: { crisis: true, genetics_question: true },
      },
    });

    const result = await screenText("some text", client);

    expect(result).toEqual({ storeNothing: true });
  });

  it("FAILS SAFE as store-nothing when parsing fails", async () => {
    const { client } = makeClient({
      messagesParse: {
        stop_reason: "end_turn",
        parsed_output: { unexpected: "shape" },
      },
    });

    const result = await screenText("some text", client);

    expect(result).toEqual({ storeNothing: true });
  });
});
