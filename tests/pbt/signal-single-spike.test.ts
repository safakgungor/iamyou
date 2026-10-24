// Feature: health-baseline, Property 1: A single spike never signals
//
// Validates: Requirements 4.6
//
// For any weekly history in which exactly one week has a z-score with
// |z| >= Z_THRESHOLD for any feature, and every z-score of every other week has
// |z| < Z_THRESHOLD, detectSignal(rows) returns null. The rows come from
// stableThenSpikeArb in a random order; the antecedent ("exactly one deviating
// week") is asserted through zScores before the signal is checked.
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { detectSignal, Z_THRESHOLD } from "@/lib/signal";
import { zScores } from "@/lib/baseline";
import { permutationArb, stableThenSpikeArb } from "./helpers/weekly-rows";

/** A spike history in any input order. */
const shuffledSpikeArb = stableThenSpikeArb.chain((rows) => permutationArb(rows));

describe("detectSignal (Property 1: a single spike never signals)", () => {
  it("returns null when exactly one week has any |z| >= Z_THRESHOLD", () => {
    fc.assert(
      fc.property(shuffledSpikeArb, (rows) => {
        // Antecedent: exactly one week deviates in at least one feature.
        const deviatingWeeks = zScores(rows).filter((week) =>
          Object.values(week.z).some((z) => z !== null && Math.abs(z) >= Z_THRESHOLD)
        );
        expect(deviatingWeeks).toHaveLength(1);

        expect(detectSignal(rows)).toBeNull();
      }),
      { numRuns: 100 }
    );
  });
});
