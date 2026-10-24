/**
 * Pure baseline and change-detection logic for the health-baseline spec. No I/O,
 * no environment reads, no mutation of inputs, and no import from `lib/signal.ts`
 * (`signal.ts` imports from here, never the reverse; design D3).
 *
 * `advanceRuns` is the one shared run detector (design D2): the chronological
 * pass and `detectSignal` both fold it over the same z-score rows, so they
 * always agree on the change signal.
 */

/** The six features, in the canonical order used for listing signals. (Req 4.9) */
export const FEATURES = [
  'vocabulary_diversity',
  'mean_sentence_length',
  'filler_rate',
  'sleep_hours',
  'active_minutes',
  'twin_accuracy',
] as const;
export type Feature = (typeof FEATURES)[number];

/** Detection constants, defined together. (Req 3.13) */
export const Z_THRESHOLD = 2.0;
export const WEEKS_REQUIRED = 3;
export const FEATURES_REQUIRED = 2;
export const MIN_BASELINE_WEEKS = 12;
/** Divisor used in place of a zero standard deviation. (Req 3.5, 3.11) */
export const SD_FLOOR = 1e-6;

/** A stored weekly_features row at the TypeScript boundary. */
export type WeeklyFeatureRow = { weekStart: string; synthetic: boolean } & Record<
  Feature,
  number | null
>;
/** What the pure functions accept: a feature may be null or missing. (Req 3.4) */
export type WeeklyFeatureInput = { weekStart: string } & Partial<
  Record<Feature, number | null>
>;

export type FeatureZ = Record<Feature, number | null>; // explicit null = no z-score
export type WeekZScores = { weekStart: string; z: FeatureZ };
/**
 * Mean and population SD of a feature's final baseline set. `weeks` counts the
 * VALUES in that set (one per contributing row), not distinct `weekStart`s: a
 * duplicate row of an initial-set week adds a value, so `weeks` can exceed the
 * number of distinct weeks. A non-null `BaselineStats` always means at least
 * MIN_BASELINE_WEEKS distinct weeks contributed. (Req 3.3, 3.7, 3.12)
 */
export type BaselineStats = { mean: number; sd: number; weeks: number };
export type Baseline = Record<Feature, BaselineStats | null>;

/** A detected change. `detectedWeek` is the week W of Req 4.4. */
export type ChangeSignal = {
  features: Feature[]; // canonical FEATURES order (Req 4.9)
  firstWeek: string; // earliest run start among listed features (Req 4.9)
  detectedWeek: string; // earliest week at which >= FEATURES_REQUIRED features qualify
};

export type RunState = {
  prevWeekStart: string | null;
  runs: Record<Feature, { length: number; start: string | null }>;
  signal: ChangeSignal | null; // once non-null, never changes (Req 4.4)
};

export type HistoryEvaluation = {
  weeks: WeekZScores[]; // one per input row, ascending weekStart (Req 3.15)
  // Final baseline sets (Req 3.12); null for a feature with fewer than
  // MIN_BASELINE_WEEKS distinct non-null weeks (Req 3.7). See BaselineStats.weeks.
  baseline: Baseline;
  signal: ChangeSignal | null;
  openAt: boolean[]; // openAt[i]: a change signal is open at weeks[i] (Req 3.14)
};

/**
 * The value of feature `f` in `row` when it is a finite number, otherwise
 * `null`. `null`, `undefined`, `NaN` and `±Infinity` are all missing (design D8);
 * a missing value is never treated as 0. (Req 3.4)
 */
export function featureValue(row: WeeklyFeatureInput, f: Feature): number | null {
  const v = row[f];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Tie-break key for rows sharing a `weekStart`. */
function tieKey(row: WeeklyFeatureInput): string {
  return FEATURES.map((f) => String(featureValue(row, f))).join('|');
}

/**
 * A sorted copy of `rows`, ascending by `weekStart` (ISO `YYYY-MM-DD` strings
 * sort lexically in date order). Ties are broken by the feature-value key, so
 * any permutation of the same rows yields the same order. The input is not
 * mutated. (Req 3.2, 4.8)
 */
export function canonicalOrder<T extends WeeklyFeatureInput>(rows: readonly T[]): T[] {
  return rows
    .map((row) => ({ row, key: tieKey(row) }))
    .sort((a, b) => {
      if (a.row.weekStart !== b.row.weekStart) {
        return a.row.weekStart < b.row.weekStart ? -1 : 1;
      }
      if (a.key !== b.key) return a.key < b.key ? -1 : 1;
      return 0;
    })
    .map(({ row }) => row);
}

/**
 * Mean and population standard deviation (divides by `n`, not `n − 1`).
 * An empty list has no mean, so both values are `NaN`.
 */
export function meanAndPopSd(values: readonly number[]): { mean: number; sd: number } {
  const n = values.length;
  if (n === 0) return { mean: NaN, sd: NaN };
  let sum = 0;
  for (const v of values) sum += v;
  const mean = sum / n;
  let squares = 0;
  for (const v of values) {
    const d = v - mean;
    squares += d * d;
  }
  return { mean, sd: Math.sqrt(squares / n) };
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

/** UTC day number of a `YYYY-MM-DD` string, or `NaN` when it is not a real calendar date. */
function utcDayNumber(date: string): number {
  const m = ISO_DATE.exec(date);
  if (m === null) return NaN;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const ms = Date.UTC(year, month - 1, day);
  // Reject dates that Date.UTC silently normalises (e.g. 2026-02-30).
  const check = new Date(ms);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return NaN;
  }
  return ms / MS_PER_DAY;
}

/**
 * Days from `a` to `b`, using `Date.UTC` only (no local time zone, no locale).
 * An unparsable date gives `NaN`, which is never 7, so it is never consecutive.
 */
function daysBetween(a: string, b: string): number {
  return utcDayNumber(b) - utcDayNumber(a);
}

/** The lexically smallest string; ISO dates compare in date order. */
function minString(values: readonly string[]): string {
  let min = values[0];
  for (const v of values) if (v < min) min = v;
  return min;
}

/** The state before any week has been seen: no runs, no signal. */
export function initialRunState(): RunState {
  const runs = {} as RunState['runs'];
  for (const f of FEATURES) runs[f] = { length: 0, start: null };
  return { prevWeekStart: null, runs, signal: null };
}

/**
 * Advances per-feature deviation runs by one week and sets the change signal at
 * the earliest week where at least FEATURES_REQUIRED features each have a run
 * of at least WEEKS_REQUIRED consecutive weeks with |z| >= Z_THRESHOLD.
 * Pure: returns a new state and never mutates `state` or `week`.
 * (Req 4.3, 4.4, 4.9)
 */
export function advanceRuns(state: RunState, week: WeekZScores): RunState {
  // Two weeks are consecutive only when exactly 7 days apart. (Req 4.3)
  const consecutive =
    state.prevWeekStart !== null && daysBetween(state.prevWeekStart, week.weekStart) === 7;

  const runs = {} as RunState['runs'];
  for (const f of FEATURES) {
    const prev = consecutive ? state.runs[f] : { length: 0, start: null }; // gap resets
    const z = week.z[f];
    runs[f] =
      z !== null && Math.abs(z) >= Z_THRESHOLD // either sign counts (Req 4.3)
        ? { length: prev.length + 1, start: prev.length === 0 ? week.weekStart : prev.start }
        : { length: 0, start: null }; // null z or |z| < threshold resets
  }

  let signal = state.signal;
  if (signal === null) {
    // Only the earliest qualifying week sets the signal. (Req 4.4)
    const qualifying = FEATURES.filter((f) => runs[f].length >= WEEKS_REQUIRED);
    if (qualifying.length >= FEATURES_REQUIRED) {
      signal = {
        features: qualifying, // canonical order (Req 4.9)
        firstWeek: minString(qualifying.map((f) => runs[f].start as string)),
        detectedWeek: week.weekStart,
      };
    }
  }
  return { prevWeekStart: week.weekStart, runs, signal };
}

/** The change signal from folding `advanceRuns` over `weeks` in the given order. */
export function signalFromZScores(weeks: readonly WeekZScores[]): ChangeSignal | null {
  return weeks.reduce(advanceRuns, initialRunState()).signal;
}

/** A fresh per-feature record, each value built by `make`. */
function emptyPerFeature<T>(make: () => T): Record<Feature, T> {
  const out = {} as Record<Feature, T>;
  for (const f of FEATURES) out[f] = make();
  return out;
}

/**
 * The single chronological pass (design D1). For each week W in ascending
 * `weekStart` order it (a) computes W's z-scores against the baseline sets as
 * they stand before W, (b) folds `advanceRuns` to get the open-signal state at
 * W, and (c) decides whether W's values join the baseline sets, before moving
 * to the next week. Pure: the input is not mutated. (Req 3.2–3.12, 3.14, 3.15)
 *
 * Initial baseline set and duplicate rows (Req 3.3, 3.6, 3.7). Each feature's
 * initial set is made of its first MIN_BASELINE_WEEKS DISTINCT `weekStart`s
 * with a non-null value, not its first 12 rows. A row with a non-null value
 * belongs to the feature's initial set when either
 *   - fewer than 12 distinct weeks have contributed so far, or
 *   - its `weekStart` is one that has already contributed (a duplicate row of
 *     an initial-set week, including the 12th).
 * Such a row gets no z-score and its value joins the initial set, but it never
 * counts as a new week. Every row of a given week is therefore treated the same
 * way, so the rule does not depend on how duplicates are ordered (and
 * `canonicalOrder` makes ties deterministic anyway). Because z-scores only start
 * after 12 distinct weeks, and a signal needs WEEKS_REQUIRED weeks of z-scores,
 * no signal can come from fewer than 12 distinct weeks (Req 4.7).
 */
export function evaluateHistory(rows: readonly WeeklyFeatureInput[]): HistoryEvaluation {
  const ordered = canonicalOrder(rows); // input order is irrelevant (Req 3.2)
  const sets = emptyPerFeature<number[]>(() => []); // baseline set per feature
  // Distinct weekStarts that have contributed to each feature's initial set.
  const initialWeeks = emptyPerFeature(() => new Set<string>());
  let runState = initialRunState();
  const weeks: WeekZScores[] = [];
  const openAt: boolean[] = [];

  for (const row of ordered) {
    // (a) z-scores of W against the baseline sets as they stand before W. (Req 3.5)
    const z = {} as FeatureZ;
    const inInitial = {} as Record<Feature, boolean>;
    for (const f of FEATURES) {
      const v = featureValue(row, f);
      inInitial[f] =
        v !== null &&
        (initialWeeks[f].size < MIN_BASELINE_WEEKS || initialWeeks[f].has(row.weekStart));
      if (v === null || inInitial[f]) {
        z[f] = null; // missing value or initial-set week: no z-score (Req 3.4, 3.6, 3.7)
      } else {
        const { mean, sd } = meanAndPopSd(sets[f]); // excludes W's own value
        z[f] = (v - mean) / Math.max(sd, SD_FLOOR); // zero sd floored (Req 3.5, 3.11)
      }
    }
    const week: WeekZScores = { weekStart: row.weekStart, z };
    weeks.push(week);

    // (b) open-signal state at W, via the shared run detector. (Req 3.14)
    runState = advanceRuns(runState, week);
    const open = runState.signal !== null; // once open, open for every later week
    openAt.push(open);

    // (c) baseline extension. (Req 3.3, 3.8, 3.9, 3.10)
    const deviating = FEATURES.some((f) => {
      const zf = z[f];
      return zf !== null && Math.abs(zf) >= Z_THRESHOLD;
    });
    for (const f of FEATURES) {
      const v = featureValue(row, f);
      if (v === null) continue;
      if (inInitial[f]) {
        // The initial set takes every value of its first 12 distinct non-null
        // weeks unconditionally; a duplicate week is added to the Set only once. (Req 3.3, 3.9)
        sets[f].push(v);
        initialWeeks[f].add(row.weekStart);
      } else if (!open && !deviating) {
        // First used for the week after W. (Req 3.8; blocked by 3.9, 3.10)
        sets[f].push(v);
      }
    }
  }

  const baseline = {} as Baseline;
  for (const f of FEATURES) {
    baseline[f] =
      initialWeeks[f].size < MIN_BASELINE_WEEKS
        ? null // fewer than 12 distinct non-null weeks (Req 3.7)
        : { ...meanAndPopSd(sets[f]), weeks: sets[f].length }; // final set (Req 3.12)
  }
  return { weeks, baseline, signal: runState.signal, openAt };
}

/** One entry per input row, ascending `weekStart`; `[]` for no rows. (Req 3.1, 3.15) */
export function zScores(rows: readonly WeeklyFeatureInput[]): WeekZScores[] {
  return evaluateHistory(rows).weeks;
}

/** Mean and population SD of each feature's final baseline set, or null. (Req 3.1, 3.12) */
export function computeBaseline(rows: readonly WeeklyFeatureInput[]): Baseline {
  return evaluateHistory(rows).baseline;
}

/**
 * care-outputs support: the mean of `feature` over rows whose `weekStart` lies
 * in `(latest − 7·windowWeeks days, latest]`, where `latest` is the latest
 * `weekStart` in `rows`. Returns `null` when no row in the window has a value.
 */
export function recentMean(
  rows: readonly WeeklyFeatureInput[],
  feature: Feature,
  windowWeeks = 4,
): number | null {
  if (rows.length === 0) return null;
  const latest = latestWeekStart(rows);
  const windowDays = 7 * windowWeeks;
  let sum = 0;
  let count = 0;
  for (const row of rows) {
    const age = daysBetween(row.weekStart, latest); // NaN for unparsable dates: excluded
    if (!(age >= 0 && age < windowDays)) continue;
    const v = featureValue(row, feature);
    if (v === null) continue;
    sum += v;
    count += 1;
  }
  return count === 0 ? null : sum / count;
}

/** The lexically largest `weekStart`; ISO dates compare in date order. */
function latestWeekStart(rows: readonly WeeklyFeatureInput[]): string {
  let max = rows[0].weekStart;
  for (const r of rows) if (r.weekStart > max) max = r.weekStart;
  return max;
}
