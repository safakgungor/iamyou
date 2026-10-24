// Feature: health-baseline, Task 2.6: unit tests for `lib/baseline.ts`.
//
// `lib/baseline.ts` is pure (no I/O), so these tests call it directly with
// hand-built synthetic weekly rows.
//
// Covered behaviours:
//   - The detection constants are 2.0 / 3 / 2 / 12 (Req 3.13).
//   - Exactly 12 non-null weeks: no z-score in any of them, but a baseline;
//     11 weeks: a `null` baseline and no z-score (Req 3.6, 3.7).
//   - A constant initial set (sd = 0) gives z = 0 for an equal value and a
//     large finite z otherwise (Req 3.11).
//   - A null week is skipped, never treated as 0 (Req 3.4).
//   - A deviating week leaves the baseline stats unchanged (Req 3.9).
//   - `recentMean` averages the last 4 weeks and is `null` with no data.
//   - Edge choices: `meanAndPopSd([])` is NaN/NaN; an impossible calendar date
//     (2026-02-30) never counts as consecutive.
//
// Validates: Requirements 3.4, 3.6, 3.7, 3.9, 3.11, 3.13
import { describe, expect, it } from "vitest";
import {
  FEATURES,
  FEATURES_REQUIRED,
  MIN_BASELINE_WEEKS,
  WEEKS_REQUIRED,
  Z_THRESHOLD,
  advanceRuns,
  computeBaseline,
  initialRunState,
  meanAndPopSd,
  recentMean,
  zScores,
  type FeatureZ,
  type WeeklyFeatureInput,
} from "@/lib/baseline";

/** `weekStart` of week `k`: 2026-01-03 + 7k days, as `YYYY-MM-DD`. */
function weekStart(k: number): string {
  return new Date(Date.UTC(2026, 0, 3 + 7 * k)).toISOString().slice(0, 10);
}

/** One synthetic row per value, consecutive weeks, setting only `sleep_hours`. */
function sleepWeeks(values: readonly (number | null)[]): WeeklyFeatureInput[] {
  return values.map((sleep_hours, k) => ({ weekStart: weekStart(k), sleep_hours }));
}

/** A z-score record with every feature `null` except those given. */
function zOf(partial: Partial<FeatureZ>): FeatureZ {
  const z = {} as FeatureZ;
  for (const f of FEATURES) z[f] = partial[f] ?? null;
  return z;
}

describe("detection constants", () => {
  it("are 2.0 / 3 / 2 / 12 (Req 3.13)", () => {
    expect(Z_THRESHOLD).toBe(2.0);
    expect(WEEKS_REQUIRED).toBe(3);
    expect(FEATURES_REQUIRED).toBe(2);
    expect(MIN_BASELINE_WEEKS).toBe(12);
  });
});

describe("initial baseline set", () => {
  it("gives no z-score for exactly 12 non-null weeks but a non-null baseline (Req 3.6, 3.7)", () => {
    const rows = sleepWeeks([7, 8, 7, 8, 7, 8, 7, 8, 7, 8, 7, 8]);
    const weeks = zScores(rows);
    expect(weeks).toHaveLength(12);
    for (const w of weeks) expect(w.z.sleep_hours).toBeNull();
    expect(computeBaseline(rows).sleep_hours).toEqual({ mean: 7.5, sd: 0.5, weeks: 12 });
  });

  it("gives a null baseline and no z-score for 11 non-null weeks (Req 3.7)", () => {
    const rows = sleepWeeks([7, 8, 7, 8, 7, 8, 7, 8, 7, 8, 7]);
    for (const w of zScores(rows)) expect(w.z.sleep_hours).toBeNull();
    expect(computeBaseline(rows).sleep_hours).toBeNull();
  });

  it("gives a null baseline for a feature with no values at all (Req 3.7)", () => {
    const baseline = computeBaseline(sleepWeeks(Array(12).fill(7)));
    expect(baseline.active_minutes).toBeNull();
  });
});

describe("zero standard deviation", () => {
  const constant = Array<number>(12).fill(5);

  it("gives z = 0 for a value equal to a constant baseline (Req 3.11)", () => {
    const weeks = zScores(sleepWeeks([...constant, 5]));
    expect(weeks[12].z.sleep_hours).toBe(0);
  });

  it("gives a large finite z for any other value (Req 3.11)", () => {
    const z = zScores(sleepWeeks([...constant, 6]))[12].z.sleep_hours as number;
    expect(Number.isFinite(z)).toBe(true);
    expect(z).toBeCloseTo(1 / 1e-6, 0);
    const below = zScores(sleepWeeks([...constant, 4]))[12].z.sleep_hours as number;
    expect(below).toBeCloseTo(-1 / 1e-6, 0);
  });
});

describe("missing values", () => {
  it("skips a null week rather than treating it as 0 (Req 3.4)", () => {
    const rows = sleepWeeks([8, 8, 8, 8, 8, null, 8, 8, 8, 8, 8, 8, 8]);
    expect(zScores(rows)[5].z.sleep_hours).toBeNull();
    // A zeroed week would pull the mean below 8 and give sd > 0.
    expect(computeBaseline(rows).sleep_hours).toEqual({ mean: 8, sd: 0, weeks: 12 });
  });

  it("treats an absent feature key the same as null (Req 3.4)", () => {
    const rows = sleepWeeks(Array(12).fill(8));
    rows.splice(3, 0, { weekStart: "2026-01-23" }); // between weeks 2 and 3, no values
    const out = zScores(rows);
    expect(out).toHaveLength(13);
    expect(computeBaseline(rows).sleep_hours).toEqual({ mean: 8, sd: 0, weeks: 12 });
  });
});

describe("deviating weeks", () => {
  const initial = [7, 8, 7, 8, 7, 8, 7, 8, 7, 8, 7, 8]; // mean 7.5, sd 0.5

  it("leaves the baseline stats unchanged after a deviating week (Req 3.9)", () => {
    const rows = sleepWeeks([...initial, 10]); // z = 5
    expect(zScores(rows)[12].z.sleep_hours).toBe(5);
    expect(computeBaseline(rows).sleep_hours).toEqual({ mean: 7.5, sd: 0.5, weeks: 12 });
  });

  it("does not append a feature's value when another feature deviates that week (Req 3.9)", () => {
    const rows: WeeklyFeatureInput[] = initial.map((v, k) => ({
      weekStart: weekStart(k),
      sleep_hours: v,
      active_minutes: k % 2 === 0 ? 30 : 40, // mean 35, sd 5
    }));
    rows.push({ weekStart: weekStart(12), sleep_hours: 7.5, active_minutes: 60 }); // z = 0 and 5
    const z = zScores(rows)[12].z;
    expect(z.sleep_hours).toBe(0);
    expect(z.active_minutes).toBe(5);
    const baseline = computeBaseline(rows);
    expect(baseline.sleep_hours).toEqual({ mean: 7.5, sd: 0.5, weeks: 12 });
    expect(baseline.active_minutes).toEqual({ mean: 35, sd: 5, weeks: 12 });
  });

  it("appends a non-deviating week beyond the initial set, for contrast", () => {
    const rows = sleepWeeks([...initial, 7.5]);
    expect(computeBaseline(rows).sleep_hours?.weeks).toBe(13);
  });
});

describe("recentMean", () => {
  it("averages the last 4 weeks up to the latest weekStart", () => {
    expect(recentMean(sleepWeeks([1, 2, 3, 4, 5, 6]), "sleep_hours")).toBe(4.5);
  });

  it("ignores input order and skips null weeks in the window", () => {
    const rows = sleepWeeks([1, 2, 3, null, 5, 6]).reverse();
    expect(recentMean(rows, "sleep_hours")).toBeCloseTo((3 + 5 + 6) / 3, 12);
  });

  it("returns null with no rows or no values in the window", () => {
    expect(recentMean([], "sleep_hours")).toBeNull();
    expect(recentMean(sleepWeeks([7, 8, null, null, null, null]), "sleep_hours")).toBeNull();
    expect(recentMean(sleepWeeks([7, 8]), "active_minutes")).toBeNull();
  });
});

describe("edge choices", () => {
  it("meanAndPopSd([]) returns NaN for both mean and sd", () => {
    const { mean, sd } = meanAndPopSd([]);
    expect(mean).toBeNaN();
    expect(sd).toBeNaN();
  });

  it("meanAndPopSd divides by n (population sd)", () => {
    expect(meanAndPopSd([2, 4])).toEqual({ mean: 3, sd: 1 });
  });

  it("never treats an impossible calendar date as consecutive", () => {
    const z = zOf({ sleep_hours: 3, active_minutes: 3 });
    const first = advanceRuns(initialRunState(), { weekStart: "2026-02-23", z });
    // Date.UTC would normalise 2026-02-30 to 2026-03-02, exactly 7 days later.
    const bad = advanceRuns(first, { weekStart: "2026-02-30", z });
    expect(bad.runs.sleep_hours).toEqual({ length: 1, start: "2026-02-30" });
    // The real date 7 days later does extend the run.
    const good = advanceRuns(first, { weekStart: "2026-03-02", z });
    expect(good.runs.sleep_hours).toEqual({ length: 2, start: "2026-02-23" });
  });
});
