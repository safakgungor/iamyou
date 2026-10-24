/**
 * Pure response shaping for the opted-in branch of `GET /api/timeline`.
 * No I/O, no environment reads, no mutation of inputs, and nothing server-only.
 *
 * Called only by `getTimeline`, after it has confirmed
 * `health_layer_opt_in === true` (design D11). Every object below is built with
 * a fixed key order, so the JSON bytes are deterministic for the same input.
 * (Req 7.1–7.4, 7.15, 9.3)
 */
import type { TimelineOptedIn } from './api-schemas';
import {
  FEATURES,
  canonicalOrder,
  computeBaseline,
  featureValue,
  zScores,
  type Feature,
  type FeatureZ,
  type WeekZScores,
  type WeeklyFeatureRow,
} from './baseline';
import { detectSignal, gate } from './signal';

type RtkSetting = NonNullable<TimelineOptedIn['rtk_setting']>;
type TimelineRowOut = TimelineOptedIn['rows'][number];
type TimelineZOut = TimelineOptedIn['z_scores'][number];
type BaselineOut = TimelineOptedIn['baseline'];
type SignalOut = NonNullable<TimelineOptedIn['signal']>;

/** Exact match only; any other value (casing, whitespace, null, ...) is not a setting. */
function isRtkSetting(value: unknown): value is RtkSetting {
  return value === 'tell_me' || value === 'doctor_only' || value === 'record_only';
}

/** The six feature values in canonical order; a non-finite value is `null` (design D8). */
function featureValues(row: WeeklyFeatureRow): Record<Feature, number | null> {
  return {
    vocabulary_diversity: featureValue(row, 'vocabulary_diversity'),
    mean_sentence_length: featureValue(row, 'mean_sentence_length'),
    filler_rate: featureValue(row, 'filler_rate'),
    sleep_hours: featureValue(row, 'sleep_hours'),
    active_minutes: featureValue(row, 'active_minutes'),
    twin_accuracy: featureValue(row, 'twin_accuracy'),
  };
}

/** One stored row: `week_start`, the six features, `synthetic`. (Req 7.1) */
function toRowResponse(row: WeeklyFeatureRow): TimelineRowOut {
  return { week_start: row.weekStart, ...featureValues(row), synthetic: row.synthetic };
}

/** The six z-scores in canonical order; a missing z-score is an explicit `null`. */
function zValues(z: FeatureZ): Record<Feature, number | null> {
  const out = {} as Record<Feature, number | null>;
  for (const f of FEATURES) {
    const v = z[f];
    out[f] = typeof v === 'number' && Number.isFinite(v) ? v : null; // never 0 (Req 7.2)
  }
  return out;
}

/** One week's z-scores: `week_start`, then the six features. (Req 7.2) */
function toZResponse(week: WeekZScores): TimelineZOut {
  return { week_start: week.weekStart, ...zValues(week.z) };
}

/**
 * Shapes the opted-in timeline for `rows` and the caller's own `rtkSetting`.
 * The change signal is included only when `gate(...).showToUser === true`;
 * otherwise `signal` is `null` through the same code path as "no signal", so a
 * gated signal is byte-identical to no signal. (Req 5.6, 5.7, 7.3, 7.4 / P13)
 */
export function buildTimeline(
  rows: readonly WeeklyFeatureRow[],
  rtkSetting: unknown,
): TimelineOptedIn {
  const ordered = canonicalOrder(rows); // ascending week_start (Req 7.1)
  const z = zScores(rows); // explicit nulls (Req 7.2)
  const stats = computeBaseline(rows); // null below MIN_BASELINE_WEEKS (Req 7.2)

  const baseline = {} as BaselineOut;
  for (const f of FEATURES) {
    const s = stats[f];
    baseline[f] = s === null ? null : { mean: s.mean, sd: s.sd };
  }

  const detected = detectSignal(rows);
  const visible = detected !== null && gate(detected, rtkSetting).showToUser === true;
  const signal: SignalOut | null = visible
    ? {
        features: [...detected.features],
        first_week: detected.firstWeek,
        detected_week: detected.detectedWeek,
      }
    : null; // always present (D5)

  return {
    opted_in: true, // first key; the discriminant (D11, Req 9.3)
    rtk_setting: isRtkSetting(rtkSetting) ? rtkSetting : null,
    rows: ordered.map(toRowResponse),
    z_scores: z.map(toZResponse),
    baseline,
    signal,
  };
}
