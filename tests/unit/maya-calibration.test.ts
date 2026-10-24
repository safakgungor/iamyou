import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { WeeklyFeatureInput } from '../../lib/baseline';
import { detectSignal } from '../../lib/signal';
import {
  DRIFT_START_AGE,
  FEATURES,
  driftFraction,
  simulatedAge,
  type MayaFeature,
  type MayaWeeklyRow,
} from '../../scripts/generate-maya';

// Calibration of Maya's committed synthetic history: shape of the week grid, the stable
// band below 38.5, monotone drift from 38.5, and the change signal landing between 39
// and 40 (design "Calibration argument"). If a generator parameter change breaks any of
// this, regenerate with `npm run generate:maya` only after the parameters satisfy it.
// Requirements: 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9

const mayaDir = join(process.cwd(), 'data/synthetic/maya');

const profile = JSON.parse(readFileSync(join(mayaDir, 'profile.json'), 'utf8')) as {
  start_date: string;
  simulated_through: string;
};
const rows = JSON.parse(
  readFileSync(join(mayaDir, 'weekly-features.json'), 'utf8'),
) as MayaWeeklyRow[];

// Generator table from design.md (the script keeps its MODEL private, D10).
const MODEL: Record<MayaFeature, { base: number; a: number; dir: -1 | 0 | 1; decimals: number }> =
  {
    vocabulary_diversity: { base: 0.72, a: 0.02, dir: -1, decimals: 4 },
    mean_sentence_length: { base: 14.0, a: 1.0, dir: 0, decimals: 2 },
    filler_rate: { base: 2.5, a: 0.4, dir: 1, decimals: 3 },
    sleep_hours: { base: 7.3, a: 0.3, dir: -1, decimals: 2 },
    active_minutes: { base: 280, a: 30, dir: 0, decimals: 0 },
    twin_accuracy: { base: 0.78, a: 0.04, dir: -1, decimals: 4 },
  };
const DRIFTING = FEATURES.filter((f) => MODEL[f].dir !== 0);

const ageOf = (weekStart: string) =>
  simulatedAge(profile.start_date, profile.simulated_through, weekStart);

const DAY_MS = 86_400_000;
const utcMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/** The committed rows at the pure-function boundary (`week_start` → `weekStart`). */
function toInput(row: MayaWeeklyRow): WeeklyFeatureInput {
  const input: WeeklyFeatureInput = { weekStart: row.week_start };
  for (const f of FEATURES) input[f] = row[f];
  return input;
}

describe('Maya weekly-features.json calibration', () => {
  it('has one row per 7-day week from start_date to simulated_through inclusive (6.3)', () => {
    expect(rows).toHaveLength(1149);
    expect(rows[0].week_start).toBe(profile.start_date);
    expect(rows[rows.length - 1].week_start).toBe(profile.simulated_through);
    for (let i = 1; i < rows.length; i++) {
      expect(utcMs(rows[i].week_start) - utcMs(rows[i - 1].week_start)).toBe(7 * DAY_MS);
    }
    expect(ageOf(rows[0].week_start)).toBe(18);
    expect(ageOf(rows[rows.length - 1].week_start)).toBe(40);
  });

  it('marks every row synthetic (6.8)', () => {
    expect(rows.every((r) => r.synthetic === true)).toBe(true);
  });

  it('keeps every value within a_f (+ rounding) of base_f below age 38.5 (6.4)', () => {
    const stable = rows.filter((r) => ageOf(r.week_start) < DRIFT_START_AGE);
    expect(stable.length).toBeGreaterThan(1000);
    for (const r of stable) {
      for (const f of FEATURES) {
        const { base, a, decimals } = MODEL[f];
        const tolerance = a + 0.5 * 10 ** -decimals + 1e-9;
        expect(Math.abs(r[f] - base), `${f} at ${r.week_start}`).toBeLessThanOrEqual(tolerance);
      }
    }
  });

  it('drifts monotonically from 38.5 and deviates more at 40 than at 38.5 (6.5)', () => {
    // driftFraction is 0 below 38.5 and non-decreasing on a fine grid up to 40.
    let prev = driftFraction(18);
    expect(prev).toBe(0);
    for (let age = 18; age <= 40 + 1e-9; age += 0.001) {
      const s = driftFraction(age);
      if (age < DRIFT_START_AGE) expect(s).toBe(0);
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
    expect(driftFraction(DRIFT_START_AGE)).toBe(0);
    expect(driftFraction(40)).toBe(1);

    // Realised deviation in each drifting feature's direction: last row vs the first row
    // at or above 38.5.
    const atDriftStart = rows.find((r) => ageOf(r.week_start) >= DRIFT_START_AGE)!;
    const last = rows[rows.length - 1];
    for (const f of DRIFTING) {
      const { base, dir } = MODEL[f];
      const devStart = dir * (atDriftStart[f] - base);
      const devEnd = dir * (last[f] - base);
      expect(devEnd, f).toBeGreaterThan(devStart);
    }
  });

  it('first creates a change signal between ages 39 and 40 (6.6, 6.9)', () => {
    const signal = detectSignal(rows.map(toInput));
    expect(signal).not.toBeNull();
    const age = ageOf(signal!.detectedWeek);
    expect(age).toBeGreaterThanOrEqual(39);
    expect(age).toBeLessThan(40);
  });

  it('creates no change signal from the weeks before age 39 (6.7, 6.9)', () => {
    const before39 = rows.filter((r) => ageOf(r.week_start) < 39);
    expect(before39.length).toBeGreaterThan(0);
    expect(before39.length).toBeLessThan(rows.length);
    expect(detectSignal(before39.map(toInput))).toBeNull();
  });
});
