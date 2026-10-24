// Feature: twin-loop, Supporting property: Context selection
// Validates: Requirements 7.4
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { selectPredictionContext, type VaultEntry } from "@/lib/prediction";

const KINDS: VaultEntry["kind"][] = [
  "conversation",
  "correction",
  "story",
  "opinion",
  "style_example",
];

// Arbitrary array of VaultEntry across all five kinds with unique ids.
const entriesArb = fc
  .array(
    fc.record({
      kind: fc.constantFrom(...KINDS),
      text: fc.string(),
      createdAt: fc
        .date({
          min: new Date(Date.UTC(2000, 0, 1)),
          max: new Date(Date.UTC(2030, 11, 31)),
          noInvalidDate: true,
        })
        .map((d) => d.toISOString()),
    }),
    { maxLength: 60 },
  )
  // Assign unique ids positionally so the generator never produces collisions.
  .map((rows) =>
    rows.map((row, index): VaultEntry => ({
      id: `e${index}`,
      ...row,
    })),
  );

describe("selectPredictionContext (Supporting property: Context selection)", () => {
  it("includes every correction and excludes every style_example", () => {
    fc.assert(
      fc.property(entriesArb, (entries) => {
        const output = selectPredictionContext(entries);
        const outputIds = new Set(output.map((entry) => entry.id));

        // Every input `correction` entry appears in the output (match by id).
        for (const entry of entries) {
          if (entry.kind === "correction") {
            expect(outputIds.has(entry.id)).toBe(true);
          }
        }

        // No output entry has kind `style_example`.
        for (const entry of output) {
          expect(entry.kind).not.toBe("style_example");
        }
      }),
      { numRuns: 100 },
    );
  });
});
