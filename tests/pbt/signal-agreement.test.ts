// Feature: health-baseline, Property 10: Detection agrees with the pass
//
// Validates: Requirements 3.14, 4.2
//
// For any set of weekly rows, detectSignal(rows) deep-equals
// evaluateHistory(rows).signal, and for every index i,
// evaluateHistory(rows).openAt[i] equals
// signalFromZScores(zScores(rows).slice(0, i + 1)) !== null. Neither call mutates
// the (deep-frozen) input rows: a write to a frozen row throws in strict mode,
// and the rows still deep-equal a snapshot taken before freezing.
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { detectSignal } from "@/lib/signal";
import { evaluateHistory, signalFromZScores, zScores, type WeeklyFeatureInput } from "@/lib/baseline";
import { deepFreeze, driftArb, weeklyRowsArb } from "./helpers/weekly-rows";

/** Messy histories (with some duplicate weeks) and histories that raise a signal. */
const rowsArb: fc.Arbitrary<WeeklyFeatureInput[]> = fc.oneof(
  weeklyRowsArb({ duplicateRate: 0.1 }),
  driftArb
);

describe("detectSignal (Property 10: detection agrees with the pass)", () => {
  it("matches evaluateHistory's signal and per-week open state without mutating input", () => {
    fc.assert(
      fc.property(rowsArb, (generated) => {
        const snapshot = structuredClone(generated);
        const rows = deepFreeze(generated);

        const evaluation = evaluateHistory(rows);
        const signal = detectSignal(rows);

        expect(signal).toEqual(evaluation.signal);

        const weeks = zScores(rows);
        expect(evaluation.openAt).toHaveLength(weeks.length);
        evaluation.openAt.forEach((open, i) => {
          expect(open).toBe(signalFromZScores(weeks.slice(0, i + 1)) !== null);
        });

        expect(rows).toEqual(snapshot);
      }),
      { numRuns: 100 }
    );
  });
});
