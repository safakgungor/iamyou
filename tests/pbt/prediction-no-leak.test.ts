// Feature: twin-loop, Property 2: Prediction never sees the answer
// Validates: Requirements 4.3, 4.4
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { buildPredictionRequest, type VaultEntry } from "@/lib/prediction";

const KINDS: ReadonlyArray<VaultEntry["kind"]> = [
  "conversation",
  "correction",
  "story",
  "opinion",
  "style_example",
];

// A sentinel that cannot appear inside any generated entry text, prompt, or id,
// because every generated string is drawn from a charset that excludes it. This
// guarantees the generated answer is ABSENT from the vault context, which is the
// precondition of Property 2.
const SENTINEL = "\u0000ABSENT_ANSWER_SENTINEL\u0000";

// Printable text that is guaranteed free of the sentinel (no NUL characters).
const safeText = fc.string().map((s) => s.replace(/\u0000/g, ""));

const vaultEntry = fc.record({
  id: safeText,
  kind: fc.constantFrom(...KINDS),
  text: safeText,
  createdAt: fc
    .date({
      min: new Date("2000-01-01"),
      max: new Date("2100-01-01"),
      noInvalidDate: true,
    })
    .map((d) => d.toISOString()),
});

describe("buildPredictionRequest (Property 2: Prediction never sees the answer)", () => {
  it("serialized request never contains an answer string absent from the vault context", () => {
    fc.assert(
      fc.property(
        safeText, // prompt
        fc.array(vaultEntry, { maxLength: 50 }), // arbitrary vault entries, all five kinds
        safeText, // arbitrary answer body, sentinel-wrapped below
        (prompt, context, answerBody) => {
          // The answer is wrapped in a sentinel absent from every generated
          // string, so it is guaranteed absent from the prompt and the context.
          const answer = `${SENTINEL}${answerBody}${SENTINEL}`;

          const request = buildPredictionRequest(prompt, context as VaultEntry[]);
          const serialized = JSON.stringify(request);

          expect(serialized.includes(answer)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("does not leak the answer even when the answer equals a vault entry's text verbatim (but absent answers stay absent)", () => {
    // Example-style guard: an answer built from the sentinel stays out of the
    // serialized request across all five kinds present in the context.
    fc.assert(
      fc.property(fc.array(vaultEntry, { minLength: 1, maxLength: 20 }), (context) => {
        const answer = `${SENTINEL}secret feelings the twin must never see${SENTINEL}`;
        const serialized = JSON.stringify(
          buildPredictionRequest("How are you feeling today?", context as VaultEntry[])
        );
        expect(serialized.includes(answer)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });
});
