/**
 * Maya's reproducible synthetic history (health-baseline Req 6.1–6.5, 6.8).
 *
 * Writes `data/synthetic/maya/weekly-features.json`: one row per 7-day week from the
 * profile `start_date` (age 18) to `simulated_through` (age 40), inclusive (design D4).
 * Values stay within a small bounded noise band around Maya's baseline until age 38.5,
 * then three features drift down and `filler_rate` drifts up.
 *
 * Self-contained by design (D10): imports only `node:fs`, `node:path`, `node:url`, never
 * `lib/`, and uses only `+ - * /`, `Math.imul`, bit shifts and `Number.prototype.toFixed`,
 * so the output is byte-identical across runs and machines (Req 6.2). It depends on a
 * fixed seed only: no system time, locale, environment or `Math.random` (Req 6.1).
 *
 * Run with `node scripts/generate-maya.ts` (Node >= 22.18 type stripping), so only
 * erasable TypeScript syntax is used here.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Fixed seed constant (Req 6.1). */
export const MAYA_SEED = 20261024;

/** Drift reaches `DRIFT_MULTIPLIER · a_f` at age 40. */
export const DRIFT_MULTIPLIER = 4;

/** Age at which drift begins (Req 6.4, 6.5). */
export const DRIFT_START_AGE = 38.5;

/** Years over which the drift fraction ramps from 0 to 1 (38.5 → 40). */
export const DRIFT_RAMP_YEARS = 1.5;

/** Simulated ages at the profile endpoints. */
export const START_AGE = 18;
export const END_AGE = 40;

/** Same order as `FEATURES` in `lib/baseline.ts`; duplicated because of D10. */
export const FEATURES = [
  'vocabulary_diversity',
  'mean_sentence_length',
  'filler_rate',
  'sleep_hours',
  'active_minutes',
  'twin_accuracy',
] as const;
export type MayaFeature = (typeof FEATURES)[number];

export interface MayaWeeklyRow {
  week_start: string;
  vocabulary_diversity: number;
  mean_sentence_length: number;
  filler_rate: number;
  sleep_hours: number;
  active_minutes: number;
  twin_accuracy: number;
  synthetic: true;
}

interface FeatureModel {
  base: number; // baseline value base_f
  a: number; // noise half-width a_f
  dir: -1 | 0 | 1; // drift direction dir_f
  decimals: number; // rounding precision
  min: number; // lower clamp bound
  max: number | null; // upper clamp bound, null when unbounded above
}

/** Per-feature parameters from the design's generator table. */
const MODEL: Record<MayaFeature, FeatureModel> = {
  vocabulary_diversity: { base: 0.72, a: 0.02, dir: -1, decimals: 4, min: 0, max: 1 },
  mean_sentence_length: { base: 14.0, a: 1.0, dir: 0, decimals: 2, min: 0, max: null },
  filler_rate: { base: 2.5, a: 0.4, dir: 1, decimals: 3, min: 0, max: null },
  sleep_hours: { base: 7.3, a: 0.3, dir: -1, decimals: 2, min: 0, max: 24 },
  active_minutes: { base: 280, a: 30, dir: 0, decimals: 0, min: 0, max: null },
  twin_accuracy: { base: 0.78, a: 0.04, dir: -1, decimals: 4, min: 0, max: 1 },
};

/** mulberry32: 32-bit state, `Math.imul` and unsigned shifts. Returns draws in [0, 1). */
export function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// UTC civil-date arithmetic (Howard Hinnant's days_from_civil / civil_from_days),
// restricted to years >= 1 so every quotient is non-negative and `| 0` truncation
// equals floor division.
// ---------------------------------------------------------------------------

function idiv(n: number, d: number): number {
  return (n / d) | 0;
}

function parseIsoDate(iso: string): [number, number, number] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    throw new Error(`Invalid ISO date: ${iso}`);
  }
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  if (y < 1 || m < 1 || m > 12 || d < 1 || d > 31) {
    throw new Error(`Invalid ISO date: ${iso}`);
  }
  return [y, m, d];
}

/** Days since 1970-01-01 (UTC) for an ISO `YYYY-MM-DD` date. */
function daysFromCivil(iso: string): number {
  const [year, m, d] = parseIsoDate(iso);
  const y = m <= 2 ? year - 1 : year;
  const era = idiv(y, 400);
  const yoe = y - era * 400;
  const doy = idiv(153 * (m > 2 ? m - 3 : m + 9) + 2, 5) + d - 1;
  const doe = yoe * 365 + idiv(yoe, 4) - idiv(yoe, 100) + doy;
  return era * 146097 + doe - 719468;
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

/** ISO `YYYY-MM-DD` (UTC) for a count of days since 1970-01-01. */
function civilFromDays(days: number): string {
  const z = days + 719468;
  const era = idiv(z, 146097);
  const doe = z - era * 146097;
  const yoe = idiv(doe - idiv(doe, 1460) + idiv(doe, 36524) - idiv(doe, 146096), 365);
  const doy = doe - (365 * yoe + idiv(yoe, 4) - idiv(yoe, 100));
  const mp = idiv(5 * doy + 2, 153);
  const d = doy - idiv(153 * mp + 2, 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`;
}

/**
 * Simulated age, linear between the profile endpoints: exactly 18 at `startDate` and
 * exactly 40 at `through`.
 */
export function simulatedAge(startDate: string, through: string, weekStart: string): number {
  const start = daysFromCivil(startDate);
  const span = daysFromCivil(through) - start;
  if (span <= 0) {
    throw new Error('simulated_through must be after start_date');
  }
  return START_AGE + ((END_AGE - START_AGE) * (daysFromCivil(weekStart) - start)) / span;
}

/** Drift fraction s(age): 0 below 38.5, then x·x·x·x with x = min(1, (age − 38.5) / 1.5). */
export function driftFraction(age: number): number {
  if (age < DRIFT_START_AGE) return 0;
  const raw = (age - DRIFT_START_AGE) / DRIFT_RAMP_YEARS;
  const x = raw < 1 ? raw : 1;
  return x * x * x * x;
}

function clamp(value: number, min: number, max: number | null): number {
  if (value < min) return min;
  if (max !== null && value > max) return max;
  return value;
}

function featureValue(f: MayaFeature, u: number, s: number): number {
  const p = MODEL[f];
  const raw = p.base + p.a * u + p.dir * DRIFT_MULTIPLIER * p.a * s;
  return Number(clamp(raw, p.min, p.max).toFixed(p.decimals));
}

/**
 * One row per week `start_date + 7k` days (UTC), for every `k` whose week start is on or
 * before `simulated_through` (k = 0 … 1148 for Maya's profile). One PRNG draw per feature
 * per week, in `FEATURES` order.
 */
export function generateMayaWeeklyFeatures(profile: {
  start_date: string;
  simulated_through: string;
}): MayaWeeklyRow[] {
  const start = daysFromCivil(profile.start_date);
  const span = daysFromCivil(profile.simulated_through) - start;
  if (span <= 0) {
    throw new Error('simulated_through must be after start_date');
  }
  const weekCount = idiv(span, 7) + 1;
  const rand = mulberry32(MAYA_SEED);
  const rows: MayaWeeklyRow[] = [];

  for (let k = 0; k < weekCount; k++) {
    const weekStart = civilFromDays(start + 7 * k);
    const s = driftFraction(simulatedAge(profile.start_date, profile.simulated_through, weekStart));
    const values = {} as Record<MayaFeature, number>;
    for (const f of FEATURES) {
      const u = 2 * rand() - 1; // uniform in [−1, 1)
      values[f] = featureValue(f, u, s);
    }
    // Object literal with the fixed key order the committed file uses (Req 6.2).
    rows.push({
      week_start: weekStart,
      vocabulary_diversity: values.vocabulary_diversity,
      mean_sentence_length: values.mean_sentence_length,
      filler_rate: values.filler_rate,
      sleep_hours: values.sleep_hours,
      active_minutes: values.active_minutes,
      twin_accuracy: values.twin_accuracy,
      synthetic: true, // Req 6.8
    });
  }
  return rows;
}

/** The exact file contents: 2-space JSON, LF line endings, trailing newline. */
export function serializeWeeklyFeatures(rows: readonly MayaWeeklyRow[]): string {
  return JSON.stringify(rows, null, 2) + '\n';
}

function main(): void {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const dir = join(root, 'data', 'synthetic', 'maya');
  const profile = JSON.parse(readFileSync(join(dir, 'profile.json'), 'utf-8')) as {
    start_date: string;
    simulated_through: string;
  };
  const rows = generateMayaWeeklyFeatures(profile);
  writeFileSync(join(dir, 'weekly-features.json'), serializeWeeklyFeatures(rows), 'utf-8');
  console.log(
    `Wrote ${rows.length} rows (${rows[0].week_start} … ${rows[rows.length - 1].week_start})`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
