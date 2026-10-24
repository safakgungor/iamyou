/**
 * Change-signal detection and the right-not-to-know gate for the health-baseline
 * spec. Pure: no I/O, no environment reads, no mutation of inputs, and nothing
 * server-only, so it is safe to import from client components and `care-outputs`.
 *
 * `signal.ts` imports from `baseline.ts`, never the reverse (design D3).
 * `gate` is defined here and only here; every consumer imports it from
 * `lib/signal.ts` (design D6, Req 5.1).
 */
import {
  signalFromZScores,
  zScores,
  type ChangeSignal,
  type WeeklyFeatureInput,
} from './baseline';

// Same bindings as `lib/baseline.ts`, never redefined, so each is `===` its
// counterpart. (Req 4.1)
export {
  Z_THRESHOLD,
  WEEKS_REQUIRED,
  FEATURES_REQUIRED,
  MIN_BASELINE_WEEKS,
  type ChangeSignal,
  type Feature,
} from './baseline';

/**
 * The change signal for `rows`, or `null`. Takes every z-score from
 * `zScores(rows)` without recomputing it and folds the shared `advanceRuns`
 * detector over them, so it always agrees with `evaluateHistory` (design D2).
 * Pure, deterministic, and does not mutate `rows`. (Req 4.2–4.9)
 */
export function detectSignal(rows: readonly WeeklyFeatureInput[]): ChangeSignal | null {
  return signalFromZScores(zScores(rows));
}

export type GateResult = { showToUser: boolean; includeInSummary: boolean };

/**
 * Right-not-to-know gate. Fails closed: the result depends only on
 * `rtk_setting`, compared with `===`, so other casing, whitespace, `null`,
 * `undefined`, numbers and objects all hide everywhere. Never throws.
 * The only definition; import from `lib/signal.ts`. (Req 5.1–5.5)
 */
export function gate(signal: ChangeSignal | null, rtk_setting: unknown): GateResult {
  switch (rtk_setting) {
    case 'tell_me':
      return { showToUser: true, includeInSummary: true }; // Req 5.2
    case 'doctor_only':
      return { showToUser: false, includeInSummary: true }; // Req 5.3
    case 'record_only': // Req 5.4
    default:
      return { showToUser: false, includeInSummary: false }; // Req 5.5
  }
}
