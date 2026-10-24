// Feature: health-baseline, Task 4.3: unit tests for `weeklySleepHours`.
//
// `weeklySleepHours` is pure (no I/O), so these tests call it directly with
// hand-built synthetic daily rows.
//
// Covered behaviours (Req 6.11, 6.12, 6.13):
//   - The result is the arithmetic mean of the non-null `sleep_hours` values.
//   - A null or missing `sleep_hours` day is excluded from both the sum and the
//     count, never treated as 0: `[7, null, 8]` ⇒ 7.5, not 5.
//   - No day with a value (`[]` or every day null) ⇒ `null`.
//
// Validates: Requirements 6.11, 6.12, 6.13
import { describe, expect, it } from "vitest";
import { weeklySleepHours, type DailyWearableRow } from "@/lib/weekly";

/** Build one synthetic day per value, on consecutive dates. */
function days(values: readonly (number | null)[]): DailyWearableRow[] {
  return values.map((sleep_hours, i) => ({
    date: `2026-01-${String(i + 1).padStart(2, "0")}`,
    sleep_hours,
  }));
}

describe("weeklySleepHours", () => {
  it("averages the non-null days and skips a null day (Req 6.11, 6.12)", () => {
    expect(weeklySleepHours(days([7, null, 8]))).toBe(7.5);
  });

  it("skips a day whose sleep_hours is absent rather than counting it as 0 (Req 6.12)", () => {
    const rows: DailyWearableRow[] = [
      { date: "2026-01-01", sleep_hours: 7 },
      { date: "2026-01-02" },
      { date: "2026-01-03", sleep_hours: 8 },
    ];
    expect(weeklySleepHours(rows)).toBe(7.5);
  });

  it("returns null for an empty week (Req 6.13)", () => {
    expect(weeklySleepHours([])).toBeNull();
  });

  it("returns null when every day is null (Req 6.13)", () => {
    expect(weeklySleepHours(days([null, null, null]))).toBeNull();
  });
});
