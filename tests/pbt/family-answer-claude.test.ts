// Feature: care-outputs, Property 2: A family answer is cited or admits it does not know
// Extends P2 to `familyAnswer` with a fake client (task 9.4).
// Validates: Requirements 9.5, 9.6, 10.1, 10.2
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type Anthropic from "@anthropic-ai/sdk";

import { familyAnswer } from "@/lib/claude";
import type { VaultEntry } from "@/lib/db/vault-repository";
import { dontKnowAnswer } from "@/lib/family";

const entriesArb = fc
  .array(
    fc.record({
      kind: fc.constantFrom("story", "opinion", "conversation", "correction") as fc.Arbitrary<VaultEntry["kind"]>,
      text: fc.string({ maxLength: 40 }),
    }),
    { minLength: 1, maxLength: 6 },
  )
  .map((rows) => rows.map((row, i): VaultEntry => ({ id: `v${i}`, createdAt: "2030-01-01", ...row })));

/** Arbitrary model outputs: well-formed, unknown ids, malformed, refusals and parse errors. */
const outputArb = fc.oneof(
  fc.record({
    kind: fc.constant("parsed" as const),
    stop_reason: fc.constantFrom("end_turn", "max_tokens", "refusal"),
    parsed_output: fc.oneof(
      fc.record({
        answer: fc.oneof(fc.string(), fc.constantFrom("I'd wait until morning.", "My diagnosis says so.")),
        cited_entry_ids: fc.array(fc.oneof(fc.constantFrom("v0", "v1", "v2", "v9"), fc.string()), { maxLength: 5 }),
      }),
      fc.anything(),
    ),
  }),
  fc.constant({ kind: "throws" as const }),
);

describe("familyAnswer (Property 2)", () => {
  it("returns existing cited ids or exactly the Dont_Know_Answer for any model output", async () => {
    await fc.assert(
      fc.asyncProperty(entriesArb, outputArb, fc.constantFrom("Maya", null), async (entries, output, firstName) => {
        const client = {
          messages: {
            parse: async () => {
              if (output.kind === "throws") throw new SyntaxError("bad json");
              return { stop_reason: output.stop_reason, parsed_output: output.parsed_output, content: [] };
            },
          },
        } as unknown as Anthropic;

        const result = await familyAnswer({ firstName, question: "?", entries }, client);
        const ids = new Set(entries.map((e) => e.id));

        if (result.cited_entry_ids.length === 0) {
          expect(result).toEqual({ answer: dontKnowAnswer(firstName), cited_entry_ids: [] });
        } else {
          expect(new Set(result.cited_entry_ids).size).toBe(result.cited_entry_ids.length);
          for (const id of result.cited_entry_ids) expect(ids.has(id)).toBe(true);
          if (output.kind === "parsed") expect(output.stop_reason).not.toBe("refusal");
        }
      }),
      { numRuns: 200 },
    );
  });
});
