// Feature: health-baseline, Task 3.10: unit tests for `lib/signal.ts`.
//
// `lib/signal.ts` is pure (no I/O), so these tests call it directly with
// hand-built synthetic weekly rows.
//
// The synthetic history: weeks 0–11 alternate `sleep_hours` 7 / 8 (baseline
// mean 7.5, sd 0.5) and `active_minutes` 30 / 40 (mean 35, sd 5); weeks 12–13
// keep alternating (|z| = 1 at week 12, ≈ 1.08 at week 13) and join the
// baseline, which is balanced again, mean 7.5 / 35 and sd 0.5 / 5, by week 14.
// A shifted week sets sleep to 9 (z = +3) and active minutes to 20 (z = −3),
// so both features deviate, in opposite directions.
//
// Covered behaviours:
//   - Each re-exported constant is `===` its `lib/baseline.ts` counterpart (Req 4.1).
//   - A two-feature, three-week shift yields one signal with the expected
//     `features` / `firstWeek` / `detectedWeek`, either sign counting (Req 4.3, 4.4).
//   - A two-week shift, or a 14-day gap inside the run, yields `null` (Req 4.3, 4.5).
//   - A later second episode does not produce a second signal (Req 4.4).
//   - `[]` yields `null` (Req 4.5).
//   - The gate truth table for `tell_me`, `doctor_only`, `record_only` (Req 5.1–5.4).
//
// Validates: Requirements 4.1, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 5.4
import { describe, expect, it } from "vitest";
import * as baseline from "@/lib/baseline";
import type { WeeklyFeatureInput } from "@/lib/baseline";
import * as signal from "@/lib/signal";
import { detectSignal, gate, type ChangeSignal } from "@/lib/signal";

/** `weekStart` of week `k`: 2026-01-03 + 7k days, as `YYYY-MM-DD`. */
function weekStart(k: number): string {
  return new Date(Date.UTC(2026, 0, 3 + 7 * k)).toISOString().slice(0, 10);
}

/** A stable week: sleep 7 / 8 and active minutes 30 / 40, alternating with `k`. */
function stable(k: number): WeeklyFeatureInput {
  const even = k % 2 === 0;
  return { weekStart: weekStart(k), sleep_hours: even ? 7 : 8, active_minutes: even ? 30 : 40 };
}

/** A shifted week: sleep z = +3 and active minutes z = −3 against the baseline. */
function shifted(k: number): WeeklyFeatureInput {
  return { weekStart: weekStart(k), sleep_hours: 9, active_minutes: 20 };
}

/** Weeks 0–13 stable: a 12-week initial set plus two in-baseline weeks. */
function stableHistory(): WeeklyFeatureInput[] {
  return Array.from({ length: 14 }, (_, k) => stable(k));
}

describe("re-exported constants", () => {
  it("are strictly equal to their lib/baseline.ts counterparts (Req 4.1)", () => {
    expect(signal.Z_THRESHOLD).toBe(baseline.Z_THRESHOLD);
    expect(signal.WEEKS_REQUIRED).toBe(baseline.WEEKS_REQUIRED);
    expect(signal.FEATURES_REQUIRED).toBe(baseline.FEATURES_REQUIRED);
    expect(signal.MIN_BASELINE_WEEKS).toBe(baseline.MIN_BASELINE_WEEKS);
  });
});

describe("detectSignal", () => {
  it("gives no signal for the stable history, for contrast", () => {
    const rows = stableHistory();
    const weeks = baseline.zScores(rows);
    expect(weeks[12].z.sleep_hours).toBe(-1);
    expect(weeks[12].z.active_minutes).toBe(-1);
    for (const w of weeks.slice(12)) {
      expect(Math.abs(w.z.sleep_hours as number)).toBeLessThan(baseline.Z_THRESHOLD);
      expect(Math.abs(w.z.active_minutes as number)).toBeLessThan(baseline.Z_THRESHOLD);
    }
    expect(detectSignal(rows)).toBeNull();
  });

  it("gives one signal for a two-feature, three-week shift (Req 4.3, 4.4)", () => {
    const rows = [...stableHistory(), shifted(14), shifted(15), shifted(16)];
    const z = baseline.zScores(rows)[14].z;
    expect(z.sleep_hours).toBe(3);
    expect(z.active_minutes).toBe(-3); // a negative shift counts too
    const expected: ChangeSignal = {
      features: ["sleep_hours", "active_minutes"], // canonical FEATURES order
      firstWeek: weekStart(14),
      detectedWeek: weekStart(16),
    };
    expect(detectSignal(rows)).toEqual(expected);
  });

  it("gives null for a two-week shift (Req 4.3, 4.5)", () => {
    const rows = [...stableHistory(), shifted(14), shifted(15), stable(16)];
    expect(detectSignal(rows)).toBeNull();
  });

  it("gives null when a 14-day gap breaks the run (Req 4.3, 4.5)", () => {
    // Week 16 is missing, so week 17 is 14 days after week 15 and starts a new run.
    const rows = [...stableHistory(), shifted(14), shifted(15), shifted(17)];
    expect(detectSignal(rows)).toBeNull();
  });

  it("does not produce a second signal for a later second episode (Req 4.4)", () => {
    const first = [shifted(14), shifted(15), shifted(16)];
    const between = [17, 18, 19, 20].map(stable);
    const second = [shifted(21), shifted(22), shifted(23)];
    // The second episode alone would signal at week 23.
    const secondOnly = [...stableHistory(), stable(14), stable(15), stable(16), ...between, ...second];
    expect(detectSignal(secondOnly)?.detectedWeek).toBe(weekStart(23));
    // With the first episode before it, only the first signal is returned.
    const rows = [...stableHistory(), ...first, ...between, ...second];
    expect(detectSignal(rows)).toEqual({
      features: ["sleep_hours", "active_minutes"],
      firstWeek: weekStart(14),
      detectedWeek: weekStart(16),
    });
  });

  it("gives null for no rows (Req 4.5)", () => {
    expect(detectSignal([])).toBeNull();
  });
});

describe("gate", () => {
  const someSignal: ChangeSignal = {
    features: ["sleep_hours", "active_minutes"],
    firstWeek: weekStart(14),
    detectedWeek: weekStart(16),
  };
  const table = [
    ["tell_me", { showToUser: true, includeInSummary: true }], // Req 5.2
    ["doctor_only", { showToUser: false, includeInSummary: true }], // Req 5.3
    ["record_only", { showToUser: false, includeInSummary: false }], // Req 5.4
  ] as const;

  for (const [setting, expected] of table) {
    it(`maps '${setting}' to ${JSON.stringify(expected)}, with or without a signal (Req 5.1)`, () => {
      expect(gate(someSignal, setting)).toEqual(expected);
      expect(gate(null, setting)).toEqual(expected);
    });
  }
});
