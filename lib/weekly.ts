/**
 * Pure daily-to-weekly aggregation for the health layer. No I/O, no mutation
 * of inputs.
 *
 * Grouping days into a week is the caller's job: `wearable-insights` will pass
 * the `daily_wearable` rows of one 7-day week. Until that spec lands,
 * `sleep_hours` comes from `data/synthetic/maya/weekly-features.json`.
 */

/** One day of wearable data; `sleep_hours` may be null or absent. */
export type DailyWearableRow = { date: string; sleep_hours?: number | null };

/**
 * Mean of the non-null sleep_hours over one week's days; null when none.
 * Missing, `null` and non-finite values (`NaN`, `±Infinity`) are excluded from
 * both the sum and the count and are never treated as 0 (D8).
 * (Req 6.10–6.13 / P14)
 */
export function weeklySleepHours(
  dailyRows: readonly DailyWearableRow[]
): number | null {
  let total = 0;
  let count = 0;
  for (const row of dailyRows) {
    const value = row.sleep_hours;
    if (typeof value === 'number' && Number.isFinite(value)) {
      total += value;
      count += 1;
    }
  }
  return count === 0 ? null : total / count;
}
