// Feature: twin-loop, Property 1: Score clamping
// Validates: Requirements 6.2, 6.3
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { clampScore } from "@/lib/score";

describe("clampScore (Property 1: Score clamping)", () => {
  it("returns a value within [0, 1] for all numbers", () => {
    fc.assert(
      fc.property(
        fc.double({ noNaN: true }), // all finite + ±Infinity, large/negative inputs
        (x) => {
          const result = clampScore(x);
          expect(result).toBeGreaterThanOrEqual(0);
          expect(result).toBeLessThanOrEqual(1);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("maps NaN to 0", () => {
    expect(clampScore(NaN)).toBe(0);
  });

  it("handles edge-case inputs (±Infinity, large/negative)", () => {
    expect(clampScore(Infinity)).toBe(1);
    expect(clampScore(-Infinity)).toBe(0);
    expect(clampScore(Number.MAX_VALUE)).toBe(1);
    expect(clampScore(-Number.MAX_VALUE)).toBe(0);
    expect(clampScore(1.5)).toBe(1);
    expect(clampScore(-0.3)).toBe(0);
    expect(clampScore(0)).toBe(0);
    expect(clampScore(1)).toBe(1);
    expect(clampScore(0.42)).toBe(0.42);
  });
});
