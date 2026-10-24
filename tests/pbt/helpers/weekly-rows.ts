/**
 * Shared fast-check arbitraries and test doubles for the health-baseline
 * property tests (design "Shared generators").
 *
 * - `weeklyRowsArb(opts)`: messy pure-function input (nulls, missing keys,
 *   non-finite values, gaps, optional duplicate weeks), typed `WeeklyFeatureInput`.
 * - `storedWeeklyRowsArb(opts)`: the same shape of history as stored rows
 *   (`WeeklyFeatureRow`: finite number or explicit `null`, plus `synthetic`), for
 *   the repository, `buildTimeline` and the timeline route.
 * - `stableThenSpikeArb`: exactly one deviating week (P1).
 * - `driftArb`: a sustained multi-feature shift that raises a change signal.
 * - `permutationArb(rows)`: any reordering of the same rows.
 * - `deepFreeze(value)`: recursive `Object.freeze` for the no-mutation checks.
 * - `countingWeeklyRepo(inner)`: counts `listWeeklyFeatures` calls (P18, Req 9.7).
 *
 * Every generated history is returned in chronological order; tests that need
 * another order compose with `permutationArb`. Sizes stay small (60 distinct
 * weeks by default) so the O(n²) chronological pass stays fast.
 *
 * (Req 3.2, 4.6, 4.8, 9.2, 9.7)
 */
import fc from "fast-check";
import {
  FEATURES,
  MIN_BASELINE_WEEKS,
  type Feature,
  type WeeklyFeatureInput,
  type WeeklyFeatureRow,
} from "@/lib/baseline";
import {
  InMemoryWeeklyFeatureRepository,
  type WeeklyFeatureRepository,
} from "@/lib/db/weekly-feature-repository";

/* -------------------------------------------------------------------------- */
/* Dates                                                                      */
/* -------------------------------------------------------------------------- */

const MS_PER_DAY = 86_400_000;
const FIRST_START_DAY = Date.UTC(2020, 0, 1) / MS_PER_DAY;
const LAST_START_DAY = Date.UTC(2040, 0, 1) / MS_PER_DAY;

/** `YYYY-MM-DD` for a UTC day number (days since 1970-01-01). */
function isoFromDay(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

/** A random UTC start day between 2020-01-01 and 2040-01-01. */
const startDayArb = fc.integer({ min: FIRST_START_DAY, max: LAST_START_DAY });

/* -------------------------------------------------------------------------- */
/* Small building blocks                                                      */
/* -------------------------------------------------------------------------- */

/** Picks `yes` with probability `rate` and `no` otherwise; `no` is the shrink target. */
function withRate<A, B>(rate: number, yes: fc.Arbitrary<A>, no: fc.Arbitrary<B>): fc.Arbitrary<A | B> {
  const weight = Math.round(Math.min(Math.max(rate, 0), 1) * 1000);
  if (weight <= 0) return no;
  if (weight >= 1000) return yes;
  return fc.oneof(
    { arbitrary: no as fc.Arbitrary<A | B>, weight: 1000 - weight },
    { arbitrary: yes as fc.Arbitrary<A | B>, weight }
  );
}

/** Maps `-0` to `0` so generated values deep-equal their JSON round trip. */
function noNegZero(v: number): number {
  return v === 0 ? 0 : v;
}

/** A per-feature record built from one value per feature, in `FEATURES` order. */
function perFeature<T>(values: readonly T[]): Record<Feature, T> {
  const out = {} as Record<Feature, T>;
  FEATURES.forEach((f, i) => {
    out[f] = values[i];
  });
  return out;
}

/** An arbitrary producing one `T` per feature, as a `Record<Feature, T>`. */
function perFeatureArb<T>(arb: fc.Arbitrary<T>): fc.Arbitrary<Record<Feature, T>> {
  return fc.tuple(...FEATURES.map(() => arb)).map(perFeature);
}

/* -------------------------------------------------------------------------- */
/* weeklyRowsArb / storedWeeklyRowsArb                                        */
/* -------------------------------------------------------------------------- */

/** Options shared by `weeklyRowsArb` and `storedWeeklyRowsArb`. */
export type WeeklyRowsOptions = {
  /** Fewest distinct `weekStart` values (default 0). */
  minWeeks?: number;
  /** Most distinct `weekStart` values (default 60). Duplicates come on top. */
  maxWeeks?: number;
  /** Probability that a feature value is missing in a row (default 0.1). */
  nullRate?: number;
  /** Probability that a step between distinct weeks is a 14–35 day gap instead of 7 (default 0.05). */
  gapRate?: number;
  /** Probability that a week gets a second row with the same `weekStart` (default 0). */
  duplicateRate?: number;
};

/**
 * One feature cell before scaling: a unit-noise value or a kind of missing.
 * `u` is mostly in [-1, 1] with occasional outliers up to ±8, so histories mix
 * stable stretches with spikes.
 */
type Cell =
  | { kind: "value"; u: number }
  | { kind: "null" }
  | { kind: "absent" }
  | { kind: "nonFinite"; value: number };

const unitNoiseArb = fc.oneof(
  { arbitrary: fc.double({ min: -1, max: 1, noNaN: true }), weight: 9 },
  { arbitrary: fc.double({ min: -8, max: 8, noNaN: true }), weight: 1 }
);

const valueCellArb: fc.Arbitrary<Cell> = unitNoiseArb.map((u) => ({ kind: "value", u }));

/** Missing cells for pure input: explicit null, missing key, or NaN / ±Infinity. */
const inputMissingCellArb: fc.Arbitrary<Cell> = fc.oneof(
  { arbitrary: fc.constant<Cell>({ kind: "null" }), weight: 5 },
  { arbitrary: fc.constant<Cell>({ kind: "absent" }), weight: 3 },
  {
    arbitrary: fc
      .constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY)
      .map((value): Cell => ({ kind: "nonFinite", value })),
    weight: 2,
  }
);

/** Missing cells for stored rows: only an explicit null. */
const storedMissingCellArb: fc.Arbitrary<Cell> = fc.constant<Cell>({ kind: "null" });

/**
 * Per-feature level and spread. One feature in ten is a constant column
 * (`scale = 0`, zero SD), which exercises the SD floor (Req 3.11).
 */
const featureParamsArb = fc.record({
  center: fc.double({ min: 0, max: 100, noNaN: true }),
  scale: fc.oneof(
    { arbitrary: fc.double({ min: 0.1, max: 20, noNaN: true }), weight: 9 },
    { arbitrary: fc.constant(0), weight: 1 }
  ),
});
type FeatureParams = { center: number; scale: number };

type Slot = {
  step: number; // days since the previous distinct week (ignored for the first)
  cells: Record<Feature, Cell>;
  dup: "copy" | Record<Feature, Cell> | null; // second row for the same weekStart
  synthetic: boolean;
};

type RawHistory = {
  startDay: number;
  params: Record<Feature, FeatureParams>;
  slots: Slot[];
};

function rawHistoryArb(opts: WeeklyRowsOptions, missingCellArb: fc.Arbitrary<Cell>): fc.Arbitrary<RawHistory> {
  const minWeeks = opts.minWeeks ?? 0;
  const maxWeeks = Math.max(opts.maxWeeks ?? 60, minWeeks);
  const cellArb = withRate(opts.nullRate ?? 0.1, missingCellArb, valueCellArb);
  const cellsArb = perFeatureArb(cellArb);
  const stepArb = withRate(opts.gapRate ?? 0.05, fc.integer({ min: 14, max: 35 }), fc.constant(7));
  const dupArb = withRate(
    opts.duplicateRate ?? 0,
    fc.oneof(fc.constant("copy" as const), cellsArb),
    fc.constant(null)
  );
  const slotArb: fc.Arbitrary<Slot> = fc.record({
    step: stepArb,
    cells: cellsArb,
    dup: dupArb,
    synthetic: fc.boolean(),
  });
  return fc.record({
    startDay: startDayArb,
    params: perFeatureArb(featureParamsArb),
    // size "max": lengths span the whole [minWeeks, maxWeeks] range; fast-check's
    // default size would cap them near 10, below MIN_BASELINE_WEEKS.
    slots: fc.array(slotArb, { minLength: minWeeks, maxLength: maxWeeks, size: "max" }),
  });
}

/** Builds the feature part of a row; an `absent` cell leaves the key out. */
function buildFeatures(
  cells: Record<Feature, Cell>,
  params: Record<Feature, FeatureParams>
): Partial<Record<Feature, number | null>> {
  const out: Partial<Record<Feature, number | null>> = {};
  for (const f of FEATURES) {
    const cell = cells[f];
    switch (cell.kind) {
      case "value":
        out[f] = noNegZero(params[f].center + params[f].scale * cell.u);
        break;
      case "null":
        out[f] = null;
        break;
      case "nonFinite":
        out[f] = cell.value;
        break;
      case "absent":
        break; // key missing (Req 3.4)
    }
  }
  return out;
}

/** Chronological rows; a duplicate row directly follows the row it shares a week with. */
function buildRows<R>(raw: RawHistory, make: (weekStart: string, cells: Record<Feature, Cell>, slot: Slot) => R): R[] {
  const rows: R[] = [];
  let day = raw.startDay;
  raw.slots.forEach((slot, i) => {
    if (i > 0) day += slot.step;
    const weekStart = isoFromDay(day);
    rows.push(make(weekStart, slot.cells, slot));
    if (slot.dup !== null) {
      rows.push(make(weekStart, slot.dup === "copy" ? slot.cells : slot.dup, slot));
    }
  });
  return rows;
}

/**
 * Messy pure-function input: rows from a random start date in 7-day steps, with
 * occasional 14–35 day gaps, optional duplicate weeks (an exact copy or new
 * values), and per-feature missing values that are an explicit `null`, a
 * missing key, or `NaN` / `±Infinity`. Some features are constant columns.
 * Rows are in chronological order and carry no `synthetic` field.
 *
 * With the default `duplicateRate: 0` every `weekStart` is distinct.
 */
export function weeklyRowsArb(opts: WeeklyRowsOptions = {}): fc.Arbitrary<WeeklyFeatureInput[]> {
  return rawHistoryArb(opts, inputMissingCellArb).map((raw) =>
    buildRows(raw, (weekStart, cells): WeeklyFeatureInput => ({
      weekStart,
      ...buildFeatures(cells, raw.params),
    }))
  );
}

/**
 * The same histories as `weeklyRowsArb`, shaped as stored `WeeklyFeatureRow`s:
 * all six keys present, each a finite number or an explicit `null`, plus a
 * random `synthetic` flag. Use this where rows feed `WeeklyFeatureRepository`,
 * `buildTimeline` or the timeline route (the response schema rejects non-finite
 * numbers). With `duplicateRate > 0`, note that the repository keeps one row per
 * `weekStart`.
 */
export function storedWeeklyRowsArb(opts: WeeklyRowsOptions = {}): fc.Arbitrary<WeeklyFeatureRow[]> {
  return rawHistoryArb(opts, storedMissingCellArb).map((raw) =>
    buildRows(raw, (weekStart, cells, slot): WeeklyFeatureRow => {
      const features = buildFeatures(cells, raw.params);
      const row = { weekStart, synthetic: slot.synthetic } as WeeklyFeatureRow;
      for (const f of FEATURES) row[f] = features[f] ?? null;
      return row;
    })
  );
}

/* -------------------------------------------------------------------------- */
/* Stable alternation shared by stableThenSpikeArb and driftArb               */
/* -------------------------------------------------------------------------- */

/**
 * A feature that alternates `c + d`, `c − d` (or the reverse when `phase` is
 * −1). Any 12 consecutive weeks have mean `c` and population SD `d`, so a later
 * alternating week has |z| ≈ 1 (at most about 1.2 even after one skipped week
 * unbalances the set), far below Z_THRESHOLD = 2.
 */
type Alternating = { c: number; d: number; phase: 1 | -1 };

const alternatingArb: fc.Arbitrary<Alternating> = fc.record({
  c: fc.double({ min: 0, max: 100, noNaN: true }),
  d: fc.double({ min: 0.1, max: 10, noNaN: true }),
  phase: fc.constantFrom<1 | -1>(1, -1),
});

/** The stable value of `p` at week index `i`. */
function stableValue(p: Alternating, i: number): number {
  return noNegZero(p.c + p.phase * (i % 2 === 0 ? 1 : -1) * p.d);
}

/** A sustained or one-off move to `c + sign·k·d`, with `k` in [3, 10]. */
type Shift = { sign: 1 | -1; k: number };

const shiftArb: fc.Arbitrary<Shift> = fc.record({
  sign: fc.constantFrom<1 | -1>(1, -1),
  k: fc.double({ min: 3, max: 10, noNaN: true }),
});

function shiftedValue(p: Alternating, s: Shift): number {
  return noNegZero(p.c + s.sign * s.k * p.d);
}

/** A complete stored row, 7·index days after `startDay`. */
function alternatingRow(
  startDay: number,
  index: number,
  value: (f: Feature) => number
): WeeklyFeatureRow {
  const row = { weekStart: isoFromDay(startDay + 7 * index), synthetic: true } as WeeklyFeatureRow;
  for (const f of FEATURES) row[f] = value(f);
  return row;
}

/* -------------------------------------------------------------------------- */
/* stableThenSpikeArb (P1)                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Exactly one deviating week (Req 4.6 / P1). Rows are 7 days apart from a
 * random start date, every feature present and finite:
 *
 * - weeks 0–11: each feature alternates `c ± d` (the initial baseline set:
 *   mean `c`, population SD `d`; no z-scores);
 * - later weeks: the same alternation, so |z| ≈ 1;
 * - exactly one later week (with 0–20 stable weeks before and after it) where a
 *   random non-empty subset of features moves to `c ± k·d` with `k >= 3`, so
 *   |z| >= 2.9 for those features; the others keep alternating.
 *
 * The spike week is deviating, so it does not join the baseline; the single
 * skipped value moves the mean by at most 2d/13, which keeps every other week
 * well below Z_THRESHOLD.
 */
export const stableThenSpikeArb: fc.Arbitrary<WeeklyFeatureRow[]> = fc
  .record({
    startDay: startDayArb,
    params: perFeatureArb(alternatingArb),
    before: fc.integer({ min: 0, max: 20 }),
    after: fc.integer({ min: 0, max: 20 }),
    spiked: fc.subarray([...FEATURES], { minLength: 1 }),
    shifts: perFeatureArb(shiftArb),
  })
  .map(({ startDay, params, before, after, spiked, shifts }) => {
    const spikeIndex = MIN_BASELINE_WEEKS + before;
    const total = spikeIndex + 1 + after;
    const rows: WeeklyFeatureRow[] = [];
    for (let i = 0; i < total; i++) {
      rows.push(
        alternatingRow(startDay, i, (f) =>
          i === spikeIndex && spiked.includes(f)
            ? shiftedValue(params[f], shifts[f])
            : stableValue(params[f], i)
        )
      );
    }
    return rows;
  });

/* -------------------------------------------------------------------------- */
/* driftArb                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A history with a sustained change: rows 7 days apart from a random start date,
 * every feature present and finite.
 *
 * - weeks 0–11 and then 0–20 more stable weeks: each feature alternates `c ± d`;
 * - a drift of 3–10 consecutive weeks in which 2–6 features move to
 *   `c ± k·d` (`k` in [3, 10], one direction per feature) while the others keep
 *   alternating;
 * - 0–15 post-drift weeks that either return to the alternation or stay shifted.
 *
 * Drift weeks are deviating and never join the baseline, so each drifting
 * feature keeps |z| >= 2.9 and a change signal opens at the third drift week;
 * the post-drift weeks are post-signal weeks that must not be appended.
 */
export const driftArb: fc.Arbitrary<WeeklyFeatureRow[]> = fc
  .record({
    startDay: startDayArb,
    params: perFeatureArb(alternatingArb),
    stableLater: fc.integer({ min: 0, max: 20 }),
    drifting: fc.subarray([...FEATURES], { minLength: 2, maxLength: 6 }),
    shifts: perFeatureArb(shiftArb),
    driftWeeks: fc.integer({ min: 3, max: 10 }),
    after: fc.integer({ min: 0, max: 15 }),
    persist: fc.boolean(),
  })
  .map(({ startDay, params, stableLater, drifting, shifts, driftWeeks, after, persist }) => {
    const driftStart = MIN_BASELINE_WEEKS + stableLater;
    const driftEnd = driftStart + driftWeeks; // exclusive
    const total = driftEnd + after;
    const rows: WeeklyFeatureRow[] = [];
    for (let i = 0; i < total; i++) {
      const shifted = i >= driftStart && (i < driftEnd || persist);
      rows.push(
        alternatingRow(startDay, i, (f) =>
          shifted && drifting.includes(f) ? shiftedValue(params[f], shifts[f]) : stableValue(params[f], i)
        )
      );
    }
    return rows;
  });

/* -------------------------------------------------------------------------- */
/* permutationArb / deepFreeze                                                */
/* -------------------------------------------------------------------------- */

/**
 * Any permutation of `rows` (all rows kept, order shuffled), for the
 * order-independence properties. (Req 3.2, 4.8)
 */
export function permutationArb<T>(rows: readonly T[]): fc.Arbitrary<T[]> {
  return fc.shuffledSubarray([...rows], { minLength: rows.length, maxLength: rows.length });
}

/**
 * Recursively freezes `value` and every nested object or array, then returns
 * it, so a pure function that tries to mutate its input throws in strict mode.
 */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Reflect.ownKeys(value)) {
      deepFreeze((value as Record<PropertyKey, unknown>)[key]);
    }
  }
  return value;
}

/* -------------------------------------------------------------------------- */
/* countingWeeklyRepo                                                         */
/* -------------------------------------------------------------------------- */

/** A `WeeklyFeatureRepository` that also reports how often rows were listed. */
export type CountingWeeklyFeatureRepository = WeeklyFeatureRepository & {
  /** Number of `listWeeklyFeatures` calls so far, including ones that rejected. */
  readonly listCalls: number;
};

/**
 * Wraps `inner` (by default a fresh `InMemoryWeeklyFeatureRepository`) and counts
 * `listWeeklyFeatures` calls in `.listCalls`, so P18 and the Req 9.7 unit tests
 * can assert that no weekly row was read for an opted-out caller. Upserts and
 * deletes pass straight through. (Req 9.2, 9.7)
 */
export function countingWeeklyRepo(
  inner: WeeklyFeatureRepository = new InMemoryWeeklyFeatureRepository()
): CountingWeeklyFeatureRepository {
  let listCalls = 0;
  return {
    get listCalls() {
      return listCalls;
    },
    listWeeklyFeatures(userId) {
      listCalls += 1;
      return inner.listWeeklyFeatures(userId);
    },
    upsertWeeklyFeatures(userId, rows) {
      return inner.upsertWeeklyFeatures(userId, rows);
    },
    deleteForUser(userId) {
      return inner.deleteForUser(userId);
    },
  };
}
