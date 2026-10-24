// Feature: health-baseline, Property 13: The opted-in timeline never leaks a gated signal
//
// Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.15, 9.3
//
// For any stored history (messy distinct-week histories that may be empty, and
// drift histories that always raise a change signal), shuffled, and any
// rtk_setting (the three settings, near misses, or fc.anything()),
// buildTimeline(rows, rtk_setting) equals, byte for byte under JSON.stringify,
// an expected response assembled here in the fixed key order from an
// independent sort of the rows, zScores(rows), computeBaseline(rows) and
// detectSignal(rows). In particular:
//
// - a gated signal (showToUser false) gives exactly the no-signal response:
//   the same bytes as the 'tell_me' build with `signal: null` and the echoed
//   rtk_setting swapped in, and nothing else changed;
// - no signal gives `signal: null`; a shown signal carries exactly its
//   features, first week and detected week;
// - z_scores has all six features per week, a finite number or explicit null;
// - baseline[f] is null exactly when f has fewer than 12 non-null weeks;
// - rows come back in ascending week_start order;
// - `opted_in: true` is the first key and the result passes
//   TimelineOptedInSchema and the opted-in branch of TimelineResponseSchema.
//
// A run-level counter guards against a vacuous pass: both the shown and the
// gated branch must occur.
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { buildTimeline } from "@/lib/timeline";
import { detectSignal, gate } from "@/lib/signal";
import {
  FEATURES,
  MIN_BASELINE_WEEKS,
  computeBaseline,
  zScores,
  type WeeklyFeatureRow,
} from "@/lib/baseline";
import { TimelineOptedInSchema, TimelineResponseSchema } from "@/lib/api-schemas";
import { driftArb, permutationArb, storedWeeklyRowsArb } from "./helpers/weekly-rows";

const SETTINGS = ["tell_me", "doctor_only", "record_only"] as const;

/* -------------------------------------------------------------------------- */
/* Generators                                                                 */
/* -------------------------------------------------------------------------- */

/** Distinct weeks, possibly empty, or a drift that always signals; then shuffled. */
const historyArb: fc.Arbitrary<WeeklyFeatureRow[]> = fc
  .oneof(
    storedWeeklyRowsArb(),
    storedWeeklyRowsArb({ minWeeks: MIN_BASELINE_WEEKS, nullRate: 0.3 }),
    driftArb,
    driftArb
  )
  .chain((rows) => permutationArb(rows));

/** The three settings, near misses that must not count, or anything at all. */
const settingArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.constantFrom<unknown>(...SETTINGS),
  fc.constantFrom<unknown>(null, undefined, "", "Tell_me", " tell_me", "TELL_ME", "doctor-only"),
  fc.anything()
);

/* -------------------------------------------------------------------------- */
/* Independent expected response                                              */
/* -------------------------------------------------------------------------- */

/** The echoed setting: an exact match, otherwise null. */
function expectedEcho(setting: unknown): string | null {
  return (SETTINGS as readonly unknown[]).includes(setting) ? (setting as string) : null;
}

/**
 * The opted-in response with `signal` as given, in the documented key order
 * (opted_in, rtk_setting, rows, z_scores, baseline, signal).
 */
function expectedResponse(
  rows: readonly WeeklyFeatureRow[],
  setting: unknown,
  signal: { features: string[]; first_week: string; detected_week: string } | null
) {
  const sorted = [...rows].sort((a, b) => (a.weekStart < b.weekStart ? -1 : a.weekStart > b.weekStart ? 1 : 0));
  const baselineStats = computeBaseline(rows);
  const baseline: Record<string, { mean: number; sd: number } | null> = {};
  for (const f of FEATURES) {
    const s = baselineStats[f];
    baseline[f] = s === null ? null : { mean: s.mean, sd: s.sd };
  }
  return {
    opted_in: true,
    rtk_setting: expectedEcho(setting),
    rows: sorted.map((r) => {
      const out: Record<string, unknown> = { week_start: r.weekStart };
      for (const f of FEATURES) out[f] = r[f];
      out.synthetic = r.synthetic;
      return out;
    }),
    z_scores: zScores(rows).map((w) => {
      const out: Record<string, unknown> = { week_start: w.weekStart };
      for (const f of FEATURES) out[f] = w.z[f];
      return out;
    }),
    baseline,
    signal,
  };
}

/* -------------------------------------------------------------------------- */
/* Property                                                                   */
/* -------------------------------------------------------------------------- */

describe("buildTimeline (Property 13: the opted-in timeline never leaks a gated signal)", () => {
  it("hides a gated signal byte for byte and shapes every field from the rows", () => {
    let shownCases = 0;
    let gatedCases = 0;

    fc.assert(
      fc.property(historyArb, settingArb, (rows, setting) => {
        const actual = buildTimeline(rows, setting);
        const json = JSON.stringify(actual);

        // opted_in is the first key; schema passes as the opted-in branch (Req 9.3).
        expect(Object.keys(actual)).toEqual([
          "opted_in",
          "rtk_setting",
          "rows",
          "z_scores",
          "baseline",
          "signal",
        ]);
        expect(actual.opted_in).toBe(true);
        expect(TimelineOptedInSchema.safeParse(actual).success).toBe(true);
        const union = TimelineResponseSchema.safeParse(actual);
        expect(union.success).toBe(true);
        expect(union.success && union.data.opted_in).toBe(true);

        // rows in ascending week_start order, one per input row (Req 7.1).
        expect(actual.rows).toHaveLength(rows.length);
        for (let i = 1; i < actual.rows.length; i++) {
          expect(actual.rows[i - 1].week_start < actual.rows[i].week_start).toBe(true);
        }

        // z_scores: all six features, finite number or explicit null (Req 7.2).
        expect(actual.z_scores).toHaveLength(rows.length);
        for (const week of actual.z_scores) {
          for (const f of FEATURES) {
            expect(f in week).toBe(true);
            const v = week[f];
            expect(v === null || (typeof v === "number" && Number.isFinite(v))).toBe(true);
          }
        }

        // baseline[f] null exactly below 12 non-null (distinct) weeks (Req 7.2, 7.15).
        for (const f of FEATURES) {
          const nonNull = rows.filter((r) => r[f] !== null).length;
          expect(actual.baseline[f] === null).toBe(nonNull < MIN_BASELINE_WEEKS);
        }

        // Signal shaping and the gate (Req 7.3, 7.4, 7.15).
        const detected = detectSignal(rows);
        const shownSignal =
          detected === null
            ? null
            : {
                features: [...detected.features],
                first_week: detected.firstWeek,
                detected_week: detected.detectedWeek,
              };
        const noSignalJson = JSON.stringify(expectedResponse(rows, setting, null));

        // The shown branch, exercised on every input via 'tell_me'.
        const shown = buildTimeline(rows, "tell_me");
        expect(JSON.stringify(shown)).toBe(JSON.stringify(expectedResponse(rows, "tell_me", shownSignal)));
        if (detected !== null) shownCases++;

        if (detected === null) {
          expect(actual.signal).toBeNull();
          expect(json).toBe(noSignalJson);
        } else if (gate(detected, setting).showToUser) {
          expect(actual.signal).toEqual(shownSignal);
          expect(json).toBe(JSON.stringify(expectedResponse(rows, setting, shownSignal)));
        } else {
          gatedCases++;
          // Indistinguishable from no signal: same bytes as the no-signal response,
          // and as the shown build with only signal and the echoed setting replaced.
          expect(actual.signal).toBeNull();
          expect(json).toBe(noSignalJson);
          expect(json).toBe(JSON.stringify({ ...shown, rtk_setting: expectedEcho(setting), signal: null }));
        }
      }),
      { numRuns: 200 }
    );

    // Guard against a vacuous pass.
    expect(shownCases).toBeGreaterThan(0);
    expect(gatedCases).toBeGreaterThan(0);
  });
});
