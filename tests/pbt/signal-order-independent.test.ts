// Feature: health-baseline, Property 5: Detection is order-independent
//
// Validates: Requirements 4.8
//
// For any set of weekly rows with distinct `weekStart` values and any two
// permutations of it, detectSignal returns either null for both or change
// signals with identical `features` (same order), identical `firstWeek` and
// identical `detectedWeek`. Messy histories from weeklyRowsArb almost never
// raise a signal, so they are mixed with driftArb histories, which always do.
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { detectSignal } from "@/lib/signal";
import { deepFreeze, driftArb, permutationArb, weeklyRowsArb } from "./helpers/weekly-rows";

/** Histories with distinct weeks: messy input (no duplicates) or a sustained drift. */
const rowsArb = fc.oneof(weeklyRowsArb({ duplicateRate: 0 }), driftArb);

/** Two independent reorderings of the same rows, deep-frozen. */
const twoPermutationsArb = rowsArb.chain((rows) =>
  fc
    .tuple(permutationArb(rows), permutationArb(rows))
    .map(([a, b]) => ({ a: deepFreeze(a), b: deepFreeze(b) }))
);

describe("detectSignal (Property 5: detection is order-independent)", () => {
  it("returns null for both or identical signals for any two permutations of the same rows", () => {
    let signalled = 0;
    fc.assert(
      fc.property(twoPermutationsArb, ({ a, b }) => {
        // Precondition: every weekStart is distinct.
        expect(new Set(a.map((r) => r.weekStart)).size).toBe(a.length);

        const first = detectSignal(a);
        const second = detectSignal(b);

        if (first === null || second === null) {
          expect(first).toBeNull();
          expect(second).toBeNull();
          return;
        }
        signalled += 1;
        expect(second.features).toStrictEqual(first.features);
        expect(second.firstWeek).toBe(first.firstWeek);
        expect(second.detectedWeek).toBe(first.detectedWeek);
      }),
      { numRuns: 100 }
    );
    // Guard against a vacuous pass: the signal branch must be exercised.
    expect(signalled).toBeGreaterThan(0);
  });
});
