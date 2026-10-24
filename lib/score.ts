/**
 * Pure scoring logic for the twin-loop. No I/O.
 *
 * `clampScore` maps any raw grade into [0, 1] (NaN -> 0); it is the target of
 * property test P1. `weeklyTrend` averages the already-clamped scores per
 * ISO-8601 week; it is the target of property test P3.
 */

/**
 * Maps any raw grade into [0, 1]; NaN maps to 0. (Req 6.2, 6.3 / P1)
 */
export function clampScore(x: number): number {
  return Number.isNaN(x) ? 0 : Math.min(1, Math.max(0, x));
}

/**
 * Computes the ISO-8601 week key (`YYYY-Www`) for a given instant.
 *
 * ISO-8601: weeks start on Monday, and week 1 is the week that contains the
 * first Thursday of the (ISO) year — equivalently the week containing January 4.
 * The ISO week-year can differ from the calendar year near year boundaries, so
 * the returned year is the ISO week-year, not `getUTCFullYear()`.
 */
function isoWeekKey(createdAt: string): string {
  const date = new Date(createdAt);
  // Work in UTC to keep the computation deterministic across environments.
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  // ISO day of week: Monday = 1 .. Sunday = 7.
  const isoDay = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  // Shift to the Thursday of this week; the ISO year is this Thursday's year.
  d.setUTCDate(d.getUTCDate() + 4 - isoDay);
  const isoYear = d.getUTCFullYear();
  // First Thursday of the ISO year is in week 1.
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const weekNumber = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7
  );
  return `${isoYear}-W${String(weekNumber).padStart(2, '0')}`;
}

/**
 * Mean clamped score per ISO week: one value per distinct week present in the
 * input, keyed `YYYY-Www` (e.g. "2026-W45"), and no key for any absent week.
 * Scores are expected to already be clamped into [0, 1]. (Req 8.2, 8.3 / P3)
 */
export function weeklyTrend(
  answers: Array<{ createdAt: string; score: number }>
): Record<string, number> {
  const sums = new Map<string, { total: number; count: number }>();

  for (const { createdAt, score } of answers) {
    const key = isoWeekKey(createdAt);
    const bucket = sums.get(key);
    if (bucket) {
      bucket.total += score;
      bucket.count += 1;
    } else {
      sums.set(key, { total: score, count: 1 });
    }
  }

  const trend: Record<string, number> = {};
  for (const [key, { total, count }] of sums) {
    trend[key] = total / count;
  }
  return trend;
}
