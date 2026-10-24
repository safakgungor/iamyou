// Feature: health-baseline, Property 12: A change signal is well-formed and earliest
//
// Validates: Requirements 4.3, 4.4, 4.5, 4.9
//
// From zScores(rows) alone, an independent run counter defines Q(W): the
// features whose z-score has |z| >= Z_THRESHOLD in each of at least 3
// consecutive weeks (exactly 7 days apart, no null z) ending at W. Then
// detectSignal(rows) is null exactly when no week has |Q(W)| >= 2; otherwise
// detectedWeek is the earliest such W, features is Q(W) in canonical FEATURES
// order, and firstWeek is the earliest start of the listed features' runs
// ending at W.
//
// The oracle never touches advanceRuns or signalFromZScores: it parses dates
// itself and, for each week, scans backwards to measure each feature's run
// (the implementation folds forwards). Inputs mix messy histories
// (weeklyRowsArb, which rarely signals), drift histories (driftArb, which
// always signal), and drift histories with one step changed to 6, 8 or 14 days
// (or left at 7), placed mostly inside the drift, to exercise the
// "exactly 7 days apart" rule. Every input is shuffled before the call.
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { detectSignal, Z_THRESHOLD } from "@/lib/signal";
import { FEATURES, zScores, type Feature, type WeekZScores } from "@/lib/baseline";
import { driftArb, permutationArb, weeklyRowsArb } from "./helpers/weekly-rows";

const RUN_WEEKS = 3; // Req 4.3, written out rather than imported
const MIN_FEATURES = 2; // Req 4.4

/* -------------------------------------------------------------------------- */
/* Independent oracle                                                         */
/* -------------------------------------------------------------------------- */

/** Whole UTC days since 1970-01-01 for a `YYYY-MM-DD` string. */
function dayIndex(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

function deviates(z: number | null): boolean {
  return z !== null && Math.abs(z) >= Z_THRESHOLD;
}

type Expected = { detectedWeek: string; features: Feature[]; firstWeek: string };

/**
 * The expected signal: the first week index `w` (in zScores order) at which at
 * least MIN_FEATURES features have a backward run of >= RUN_WEEKS deviating
 * weeks, each step exactly 7 days.
 */
function expectedSignal(weeks: readonly WeekZScores[]): Expected | null {
  for (let w = 0; w < weeks.length; w++) {
    const qualifying: { f: Feature; start: string }[] = [];
    for (const f of FEATURES) {
      let start = w;
      if (!deviates(weeks[w].z[f])) continue;
      while (
        start > 0 &&
        deviates(weeks[start - 1].z[f]) &&
        dayIndex(weeks[start].weekStart) - dayIndex(weeks[start - 1].weekStart) === 7
      ) {
        start--;
      }
      if (w - start + 1 >= RUN_WEEKS) qualifying.push({ f, start: weeks[start].weekStart });
    }
    if (qualifying.length >= MIN_FEATURES) {
      return {
        detectedWeek: weeks[w].weekStart,
        features: qualifying.map((q) => q.f), // FEATURES iteration order
        firstWeek: qualifying.map((q) => q.start).sort()[0],
      };
    }
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Generators                                                                 */
/* -------------------------------------------------------------------------- */

/** `iso` moved by `days` whole days. */
function shiftIso(iso: string, days: number): string {
  return new Date((dayIndex(iso) + days) * 86_400_000).toISOString().slice(0, 10);
}

/**
 * A drift history where the step into row `cut` becomes 7 + extra days
 * (extra ∈ {0, −1, +1, +7}: 7, 6, 8 or 14 days) by shifting every later row.
 * `cut` is mostly a deviating week of the original history, so the change
 * usually lands inside a drift run.
 */
const gappedDriftArb = driftArb.chain((rows) => {
  const deviatingIdx: number[] = [];
  zScores(rows).forEach((week, i) => {
    if (i > 0 && FEATURES.some((f) => deviates(week.z[f]))) deviatingIdx.push(i);
  });
  const anyIdx = fc.integer({ min: 1, max: rows.length - 1 });
  const cutArb =
    deviatingIdx.length > 0
      ? fc.oneof({ arbitrary: fc.constantFrom(...deviatingIdx), weight: 4 }, { arbitrary: anyIdx, weight: 1 })
      : anyIdx;
  return fc
    .record({ cut: cutArb, extra: fc.constantFrom(0, -1, 1, 7) })
    .map(({ cut, extra }) =>
      rows.map((row, i) => (i >= cut ? { ...row, weekStart: shiftIso(row.weekStart, extra) } : row))
    );
});

const historyArb = fc
  .oneof(
    weeklyRowsArb(),
    weeklyRowsArb({ minWeeks: 12, gapRate: 0.2 }),
    driftArb,
    gappedDriftArb
  )
  .chain((rows) => permutationArb(rows));

/* -------------------------------------------------------------------------- */
/* Property                                                                   */
/* -------------------------------------------------------------------------- */

describe("detectSignal (Property 12: a change signal is well-formed and earliest)", () => {
  it("matches an independent run counter over zScores(rows)", () => {
    fc.assert(
      fc.property(historyArb, (rows) => {
        const expected = expectedSignal(zScores(rows));
        const actual = detectSignal(rows);
        if (expected === null) {
          expect(actual).toBeNull(); // Req 4.5
          return;
        }
        expect(actual).not.toBeNull();
        expect(actual!.detectedWeek).toBe(expected.detectedWeek); // Req 4.4
        expect(actual!.features).toEqual(expected.features); // Req 4.3, 4.9
        expect(actual!.firstWeek).toBe(expected.firstWeek); // Req 4.9
      }),
      { numRuns: 200 }
    );
  });
});
