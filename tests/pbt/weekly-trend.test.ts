// Feature: twin-loop, Property 3: Weekly trend shape and bounds
//
// Validates: Requirements 8.2, 8.3
//
// weeklyTrend groups already-clamped scores by ISO-8601 week and averages them,
// returning one entry per distinct week keyed `YYYY-Www`. This property asserts:
//   - the number of keys equals the number of distinct ISO weeks present in the input,
//   - no key exists for a week absent from the input, and
//   - every returned value is within [0, 1].

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { weeklyTrend } from "@/lib/score";

/**
 * Independent reference computation of the ISO-8601 week key (`YYYY-Www`) for a
 * given instant, used only to derive the EXPECTED set of distinct weeks. This
 * mirrors ISO-8601 semantics (weeks start Monday; week 1 contains the first
 * Thursday / January 4) and lets the test assert shape without trusting the
 * implementation's own grouping.
 */
function expectedIsoWeekKey(createdAt: string): string {
  const date = new Date(createdAt);
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  const isoDay = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + 4 - isoDay);
  const isoYear = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const weekNumber = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7
  );
  return `${isoYear}-W${String(weekNumber).padStart(2, "0")}`;
}

// An answer: an ISO timestamp drawn from a range spanning many weeks/years, and
// a score already clamped into [0, 1]. The wide date range guarantees that
// arbitrary lists span multiple distinct ISO weeks.
const answerArb = fc.record({
  createdAt: fc
    .date({
      min: new Date(Date.UTC(2020, 0, 1)),
      max: new Date(Date.UTC(2030, 11, 31)),
      noInvalidDate: true,
    })
    .map((d) => d.toISOString()),
  score: fc.double({ min: 0, max: 1, noNaN: true }),
});

describe("weeklyTrend (Property 3: weekly trend shape and bounds)", () => {
  it("returns one value per distinct ISO week, none for absent weeks, each in [0, 1]", () => {
    fc.assert(
      fc.property(fc.array(answerArb), (answers) => {
        const trend = weeklyTrend(answers);

        const distinctWeeks = new Set(
          answers.map((a) => expectedIsoWeekKey(a.createdAt))
        );
        const returnedKeys = Object.keys(trend);

        // One value per distinct ISO week present in the input.
        expect(returnedKeys.length).toBe(distinctWeeks.size);

        // No key exists for a week absent from the input, and every present
        // week has a key (set equality in both directions).
        for (const key of returnedKeys) {
          expect(distinctWeeks.has(key)).toBe(true);
        }
        for (const week of distinctWeeks) {
          expect(Object.prototype.hasOwnProperty.call(trend, week)).toBe(true);
        }

        // Every returned value is within [0, 1] (mean of values already in range).
        for (const value of Object.values(trend)) {
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(1);
        }
      }),
      { numRuns: 100 }
    );
  });
});
