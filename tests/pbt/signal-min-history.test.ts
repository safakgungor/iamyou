// Feature: health-baseline, Property 6: Not enough history, no signal
//
// Validates: Requirements 4.7
//
// For any weekly history with fewer than MIN_BASELINE_WEEKS (12) distinct
// week_start values, with any feature values including extreme ones,
// detectSignal(rows) returns null. Duplicate week_start values are allowed, so
// a feature can have 12 or more non-null *rows* while the history still has
// fewer than 12 distinct weeks; the dense-duplicates generator targets exactly
// that case. The antecedent (distinct weeks < 12) is asserted before the signal
// is checked.
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { detectSignal, MIN_BASELINE_WEEKS } from "@/lib/signal";
import { FEATURES, type Feature, type WeeklyFeatureInput } from "@/lib/baseline";
import { permutationArb, weeklyRowsArb } from "./helpers/weekly-rows";

const MS_PER_DAY = 86_400_000;

/** `YYYY-MM-DD` for a UTC day number (days since 1970-01-01). */
function isoFromDay(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

/** A feature cell: an ordinary or extreme finite number, or a kind of missing. */
type Cell = number | null | undefined;

/** Ordinary, huge, tiny and boundary values; any finite double is possible. */
const extremeValueArb: fc.Arbitrary<number> = fc.oneof(
  { arbitrary: fc.double({ min: -1, max: 1, noNaN: true }), weight: 4 },
  {
    arbitrary: fc.constantFrom(
      0,
      1e6,
      -1e6,
      1e300,
      -1e300,
      Number.MAX_VALUE,
      -Number.MAX_VALUE,
      Number.MIN_VALUE,
      Number.MAX_SAFE_INTEGER
    ),
    weight: 3,
  },
  { arbitrary: fc.double({ noNaN: true, noDefaultInfinity: true }), weight: 2 }
);

/** Missing values for pure input: explicit null, missing key, NaN or ±Infinity. */
const missingArb: fc.Arbitrary<Cell> = fc.constantFrom<Cell>(
  null,
  undefined,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY
);

/** Large-magnitude values that sit far from an ordinary [-1, 1] baseline. */
const hugeValueArb: fc.Arbitrary<number> = fc.oneof(
  fc.constantFrom(1e6, -1e6, 1e300, -1e300, Number.MAX_VALUE, -Number.MAX_VALUE, Number.MAX_SAFE_INTEGER),
  fc.double({ min: 10, max: 1e9, noNaN: true }),
  fc.double({ min: -1e9, max: -10, noNaN: true })
);

/**
 * How a week's values are drawn: `ordinary` (a calm [-1, 1] level that can
 * fill an initial baseline set), `huge` (far from that level) or `mixed`
 * (anything, extreme values included).
 */
type Regime = "ordinary" | "huge" | "mixed";

const regimeValueArb: Record<Regime, fc.Arbitrary<number>> = {
  ordinary: fc.double({ min: -1, max: 1, noNaN: true }),
  huge: hugeValueArb,
  mixed: extremeValueArb,
};

const cellArb = (regime: Regime): fc.Arbitrary<Cell> =>
  fc.oneof({ arbitrary: regimeValueArb[regime], weight: 9 }, { arbitrary: missingArb, weight: 1 });

/** One row for `weekStart`; an `undefined` cell leaves the key out. */
const rowArb = (weekStart: string, regime: Regime): fc.Arbitrary<WeeklyFeatureInput> =>
  fc.tuple(...FEATURES.map(() => cellArb(regime))).map((cells) => {
    const row: WeeklyFeatureInput = { weekStart };
    FEATURES.forEach((f: Feature, i) => {
      if (cells[i] !== undefined) row[f] = cells[i];
    });
    return row;
  });

/**
 * 1–11 distinct weeks, mostly 7 days apart, each with 1–16 rows whose values
 * follow a per-week regime (ordinary, huge or mixed extreme). Many duplicates
 * per week let a feature reach 12+ non-null rows (the initial baseline set)
 * early, leaving later weeks free to deviate.
 */
const denseDuplicatesArb: fc.Arbitrary<WeeklyFeatureInput[]> = fc
  .record({
    startDay: fc.integer({ min: Date.UTC(2020, 0, 1) / MS_PER_DAY, max: Date.UTC(2040, 0, 1) / MS_PER_DAY }),
    weeks: fc.array(
      fc.record({
        step: fc.oneof({ arbitrary: fc.constant(7), weight: 9 }, { arbitrary: fc.integer({ min: 14, max: 35 }), weight: 1 }),
        count: fc.oneof(
          { arbitrary: fc.integer({ min: 1, max: 2 }), weight: 2 },
          { arbitrary: fc.integer({ min: 3, max: 16 }), weight: 2 }
        ),
        regime: fc.constantFrom<Regime>("ordinary", "huge", "mixed"),
      }),
      { minLength: 1, maxLength: MIN_BASELINE_WEEKS - 1 }
    ),
  })
  .chain(({ startDay, weeks }) => {
    let day = startDay;
    const perWeek = weeks.map(({ step, count, regime }, i) => {
      if (i > 0) day += step;
      const weekStart = isoFromDay(day);
      return fc.array(rowArb(weekStart, regime), { minLength: count, maxLength: count });
    });
    return fc.tuple(...perWeek).map((groups) => groups.flat());
  });

/** Any short history: messy shared rows (with duplicates), dense duplicates, or empty. */
const shortHistoryArb: fc.Arbitrary<WeeklyFeatureInput[]> = fc
  .oneof(
    weeklyRowsArb({ maxWeeks: MIN_BASELINE_WEEKS - 1, duplicateRate: 0.5 }),
    denseDuplicatesArb,
    fc.constant<WeeklyFeatureInput[]>([])
  )
  .chain((rows) => permutationArb(rows));

describe("detectSignal (Property 6: not enough history, no signal)", () => {
  it("returns null for fewer than MIN_BASELINE_WEEKS distinct week_start values", () => {
    fc.assert(
      fc.property(shortHistoryArb, (rows) => {
        // Antecedent: fewer than 12 distinct week_start values.
        expect(new Set(rows.map((r) => r.weekStart)).size).toBeLessThan(MIN_BASELINE_WEEKS);
        expect(detectSignal(rows)).toBeNull();
      }),
      { numRuns: 1000 }
    );
  });
});
