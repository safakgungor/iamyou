// Feature: care-outputs, Task 9.3: unit tests for `familyAnswer` with a mocked
// Anthropic client.
//
// `familyAnswer(input, client?)` takes an injectable client, so these tests pass
// a fake whose `messages.parse` returns canned SDK-shaped results. The real
// Anthropic API is never called.
//
// Validates: Requirements 9.3, 9.4, 9.6, 9.7, 10.7
import { afterEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";

import { familyAnswer } from "@/lib/claude";
import type { VaultEntry } from "@/lib/db/vault-repository";

const DONT_KNOW = { answer: "I don't know how Maya would answer that.", cited_entry_ids: [] };

const ENTRIES: VaultEntry[] = [
  {
    id: "v011",
    kind: "opinion",
    text: "I don't trust decisions I make after 10 pm. If it's big, it waits until morning.",
    createdAt: "2027-06-01",
  },
  {
    id: "v033",
    kind: "correction",
    text: "I wasn't nervous about the appointment. I was tired. There's a difference, and you used to know it.",
    createdAt: "2045-01-01",
  },
];

const INPUT = { firstName: "Maya", question: "How do you make a big decision?", entries: ENTRIES };

type ParseResult = { stop_reason: string; parsed_output: unknown; content?: unknown };

function makeClient(result: ParseResult | Promise<ParseResult> | (() => Promise<ParseResult>)) {
  const parse = vi.fn(async (_req: unknown) => (typeof result === "function" ? result() : result));
  // `parsed_output` is a getter in some responses; a refusal must never touch it.
  return { client: { messages: { parse } } as unknown as Anthropic, parse };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("familyAnswer", () => {
  it("returns the Dont_Know_Answer without a call when no entry is given (Req 9.4)", async () => {
    const { client, parse } = makeClient({ stop_reason: "end_turn", parsed_output: null });
    expect(await familyAnswer({ ...INPUT, entries: [] }, client)).toEqual(DONT_KNOW);
    expect(parse).not.toHaveBeenCalled();
  });

  it("sends the model, medium effort, an id enum and one user message, with no sampling params (Req 9.3, 9.7)", async () => {
    const { client, parse } = makeClient({
      stop_reason: "end_turn",
      parsed_output: { answer: "If it's big, it waits until morning.", cited_entry_ids: ["v011"] },
    });
    await familyAnswer(INPUT, client);

    const req = parse.mock.calls[0][0] as Record<string, unknown> & {
      output_config: { effort: string; format: { schema: unknown; parse: (content: string) => unknown } };
      messages: Array<{ role: string; content: string }>;
    };
    expect(req.model).toBe("claude-opus-5-5");
    expect(req.output_config.effort).toBe("medium");
    for (const key of ["temperature", "top_p", "top_k"]) expect(req).not.toHaveProperty(key);
    expect(req.messages).toHaveLength(1);
    expect(req.messages[0].role).toBe("user");
    expect(req.messages[0].content).toContain("[v011] (opinion) I don't trust decisions");
    expect(req.messages[0].content).toContain("[v033] (correction)");
    expect(req.messages[0].content).toContain("I don't know how Maya would answer that.");
    // The output format limits citations to the ids that were sent: the SDK
    // shows the enum to the model and its parse rejects any other id. (Req 9.5)
    expect(JSON.stringify(req.output_config.format.schema)).toContain('v011');
    expect(JSON.stringify(req.output_config.format.schema)).toContain('v033');
    const { parse: parseOutput } = req.output_config.format;
    expect(parseOutput(JSON.stringify({ answer: "a", cited_entry_ids: ["v033"] }))).toEqual({
      answer: "a",
      cited_entry_ids: ["v033"],
    });
    expect(() => parseOutput(JSON.stringify({ answer: "a", cited_entry_ids: ["v999"] }))).toThrow();
  });

  it("returns the Dont_Know_Answer when the SDK rejects an output citing an unsent id", async () => {
    const { client } = makeClient(() =>
      Promise.reject(Object.assign(new Error("Failed to parse structured output"), { name: "AnthropicError" })),
    );
    expect(await familyAnswer(INPUT, client)).toEqual(DONT_KNOW);
  });

  it("passes a cited, safe answer through (Req 10.3)", async () => {
    const { client } = makeClient({
      stop_reason: "end_turn",
      parsed_output: { answer: "If it's big, it waits until morning.", cited_entry_ids: ["v011", "v011"] },
    });
    expect(await familyAnswer(INPUT, client)).toEqual({
      answer: "If it's big, it waits until morning.",
      cited_entry_ids: ["v011"],
    });
  });

  it("never reads the content of a refusal (Req 9.6)", async () => {
    const refusal = {
      stop_reason: "refusal",
      get parsed_output(): unknown {
        throw new Error("refusal content was read");
      },
      get content(): unknown {
        throw new Error("refusal content was read");
      },
    };
    const { client } = makeClient(refusal as ParseResult);
    expect(await familyAnswer(INPUT, client)).toEqual(DONT_KNOW);
  });

  it("returns the Dont_Know_Answer on malformed output or a parse error", async () => {
    for (const parsed_output of [null, "text", { answer: 3 }, { answer: "x", cited_entry_ids: ["v999"] }]) {
      const { client } = makeClient({ stop_reason: "end_turn", parsed_output });
      expect(await familyAnswer(INPUT, client)).toEqual(DONT_KNOW);
    }
    const { client } = makeClient(() => Promise.reject(new SyntaxError("Unexpected token")));
    expect(await familyAnswer(INPUT, client)).toEqual(DONT_KNOW);
  });

  it("returns the Dont_Know_Answer after a 30-second timeout", async () => {
    vi.useFakeTimers();
    const { client } = makeClient(() => new Promise<ParseResult>(() => {}));
    const pending = familyAnswer(INPUT, client);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await pending).toEqual(DONT_KNOW);
  });

  it("returns the Dont_Know_Answer when the answer adds a health term the cited entries lack (Req 10.7)", async () => {
    const { client } = makeClient({
      stop_reason: "end_turn",
      parsed_output: {
        answer: "I wait until morning, maybe because of my diagnosis.",
        cited_entry_ids: ["v011"],
      },
    });
    expect(await familyAnswer(INPUT, client)).toEqual(DONT_KNOW);
  });

  it("allows a word that is already in the cited entry", async () => {
    const { client } = makeClient({
      stop_reason: "end_turn",
      parsed_output: { answer: "I wasn't nervous about the appointment, I was tired.", cited_entry_ids: ["v033"] },
    });
    expect((await familyAnswer(INPUT, client)).cited_entry_ids).toEqual(["v033"]);
  });
});
