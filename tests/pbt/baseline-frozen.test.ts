// Feature: health-baseline, Property 11: The frozen baseline never absorbs deviating or post-signal weeks
//
// Validates: Requirements 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12
//
// A naive reference rebuilds each feature's baseline set week by week from the
// sorted rows, with its own missing-value check and its own mean / population SD,
// and must reproduce every z-score of `zScores` and the final `computeBaseline`
// statistics within a combined absolute/relative tolerance of 1e-9:
//   - the first 12 distinct week_start values with a non-null value of a feature
//     form its initial set (every row of those weeks, duplicates included),
//     whatever the other features and the signal state are, and those rows have
//     no z-score;
//   - a null, missing or non-finite value is skipped and never counted as 0;
//   - every later non-null value has z = (v − mean) / max(sd, SD_FLOOR) against
//     the set built from earlier weeks only (population SD);
//   - a later week's values are appended only when no z-score of that week has
//     |z| >= Z_THRESHOLD and no signal is open at that week (`openAt`, taken from
//     `evaluateHistory`, as the property states);
//   - a feature with fewer than 12 distinct non-null weeks has no z-score and a
//     null baseline.
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  FEATURES,
  MIN_BASELINE_WEEKS,
  SD_FLOOR,
  Z_THRESHOLD,
  canonicalOrder,
  computeBaseline,
  evaluateHistory,
  zScores,
  type Feature,
  type WeeklyFeatureInput,
} from "@/lib/baseline";
import { driftArb, weeklyRowsArb } from "./helpers/weekly-rows";

/** Combined tolerance: relative for large magnitudes (SD-floored z-scores), absolute near 0. */
function close(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

/** The reference's own missing-value rule: only a finite number counts. */
function present(row: WeeklyFeatureInput, f: Feature): number | null {
  const v = row[f];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Textbook mean and population SD (divide by n). */
function stats(values: readonly number[]): { mean: number; sd: number } {
  const n = values.length;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) * (v - mean), 0) / n;
  return { mean, sd: Math.sqrt(variance) };
}

type Reference = {
  z: Array<Record<Feature, number | null>>;
  baseline: Record<Feature, { mean: number; sd: number; weeks: number } | null>;
};

/** Naive week-by-week rebuild of every feature's baseline set from sorted rows. */
function referenceRebuild(sorted: readonly WeeklyFeatureInput[], openAt: readonly boolean[]): Reference {
  const sets = {} as Record<Feature, number[]>;
  for (const f of FEATURES) sets[f] = [];
  const z: Reference["z"] = [];

  // Up front: each feature's initial weeks are its first 12 distinct week_start
  // values (in sorted order) that have a non-null value. Every non-null row of
  // one of those weeks, duplicates included, belongs to the initial set.
  const initialWeeks = {} as Record<Feature, string[]>;
  for (const f of FEATURES) {
    const distinct: string[] = [];
    for (const row of sorted) {
      if (distinct.length === MIN_BASELINE_WEEKS) break;
      if (present(row, f) !== null && !distinct.includes(row.weekStart)) distinct.push(row.weekStart);
    }
    initialWeeks[f] = distinct;
  }

  sorted.forEach((row, i) => {
    const weekZ = {} as Record<Feature, number | null>;
    const initial = {} as Record<Feature, boolean>;
    for (const f of FEATURES) {
      const v = present(row, f);
      initial[f] = v !== null && initialWeeks[f].includes(row.weekStart);
      if (v === null || initial[f]) {
        weekZ[f] = null;
      } else {
        const { mean, sd } = stats(sets[f]);
        weekZ[f] = (v - mean) / Math.max(sd, SD_FLOOR);
      }
    }
    z.push(weekZ);

    const deviating = FEATURES.some((f) => weekZ[f] !== null && Math.abs(weekZ[f] as number) >= Z_THRESHOLD);
    for (const f of FEATURES) {
      const v = present(row, f);
      if (v === null) continue;
      if (initial[f] || (!deviating && !openAt[i])) sets[f].push(v);
    }
  });

  const baseline = {} as Reference["baseline"];
  for (const f of FEATURES) {
    // Null below 12 distinct non-null weeks; `weeks` counts the set's values.
    baseline[f] =
      initialWeeks[f].length < MIN_BASELINE_WEEKS ? null : { ...stats(sets[f]), weeks: sets[f].length };
  }
  return { z, baseline };
}

/**
 * Explicit constant columns: a random non-empty subset of features is overwritten
 * with one value per feature (only where the row has a value), so their baseline
 * SD is exactly 0 and z-scores rely on SD_FLOOR. (Req 3.11)
 */
const constantColumnsArb: fc.Arbitrary<WeeklyFeatureInput[]> = fc
  .record({
    rows: weeklyRowsArb({ minWeeks: MIN_BASELINE_WEEKS }),
    constant: fc.subarray([...FEATURES], { minLength: 1 }),
    values: fc.array(fc.double({ min: -100, max: 100, noNaN: true }), {
      minLength: FEATURES.length,
      maxLength: FEATURES.length,
    }),
    spikeEvery: fc.integer({ min: 0, max: 10 }),
  })
  .map(({ rows, constant, values, spikeEvery }) =>
    rows.map((row, i) => {
      const out: WeeklyFeatureInput = { ...row };
      constant.forEach((f) => {
        if (present(row, f) === null) return;
        const c = values[FEATURES.indexOf(f)] || 0;
        // Optionally a value off the constant now and then: a huge, finite z.
        out[f] = spikeEvery > 0 && i % spikeEvery === spikeEvery - 1 ? c + 1 : c;
      });
      return out;
    })
  );

const historyArb: fc.Arbitrary<WeeklyFeatureInput[]> = fc.oneof(
  weeklyRowsArb(),
  weeklyRowsArb({ minWeeks: MIN_BASELINE_WEEKS, nullRate: 0.3 }),
  driftArb,
  constantColumnsArb
);

describe("evaluateHistory (Property 11: the frozen baseline never absorbs deviating or post-signal weeks)", () => {
  it("matches a naive reference rebuild of every baseline set, z-score and final statistic", () => {
    fc.assert(
      fc.property(historyArb, (rows) => {
        const sorted = canonicalOrder(rows);
        const { openAt } = evaluateHistory(rows);
        expect(openAt).toHaveLength(rows.length);

        const ref = referenceRebuild(sorted, openAt);
        const weeks = zScores(rows);
        const baseline = computeBaseline(rows);

        expect(weeks.map((w) => w.weekStart)).toEqual(sorted.map((r) => r.weekStart));
        weeks.forEach((week, i) => {
          for (const f of FEATURES) {
            const expected = ref.z[i][f];
            const actual = week.z[f];
            if (expected === null) {
              expect(actual, `${week.weekStart} ${f}`).toBeNull();
            } else {
              expect(actual, `${week.weekStart} ${f}`).not.toBeNull();
              expect(
                close(actual as number, expected),
                `${week.weekStart} ${f}: got ${actual}, expected ${expected}`
              ).toBe(true);
            }
          }
        });

        for (const f of FEATURES) {
          const expected = ref.baseline[f];
          const actual = baseline[f];
          if (expected === null) {
            expect(actual, f).toBeNull();
          } else {
            expect(actual, f).not.toBeNull();
            expect(actual!.weeks, f).toBe(expected.weeks);
            expect(close(actual!.mean, expected.mean), `${f} mean: ${actual!.mean} vs ${expected.mean}`).toBe(true);
            expect(close(actual!.sd, expected.sd), `${f} sd: ${actual!.sd} vs ${expected.sd}`).toBe(true);
          }
        }
      }),
      { numRuns: 300 }
    );
  });
});
