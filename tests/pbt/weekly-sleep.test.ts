// Feature: health-baseline, Property 14: Weekly sleep ignores missing days
//
// Validates: Requirements 6.11, 6.12, 6.13
//
// weeklySleepHours averages the days that carry a sleep value. This property asserts:
//   - the result is null when no day has a finite sleep_hours,
//   - otherwise it is the arithmetic mean of exactly the valued days (within 1e-9), and
//   - inserting any number of null or missing days anywhere leaves the result unchanged.
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { weeklySleepHours, type DailyWearableRow } from "@/lib/weekly";

const dateArb = fc
  .date({
    min: new Date(Date.UTC(2020, 0, 1)),
    max: new Date(Date.UTC(2030, 11, 31)),
    noInvalidDate: true,
  })
  .map((d) => d.toISOString().slice(0, 10));

// A day with a finite sleep value in a realistic range.
const valuedRowArb: fc.Arbitrary<DailyWearableRow> = fc.record({
  date: dateArb,
  sleep_hours: fc.double({ min: 0, max: 24, noNaN: true }),
});

// A day with no sleep value: `null` or the key absent entirely.
const emptyRowArb: fc.Arbitrary<DailyWearableRow> = fc.oneof(
  fc.record({ date: dateArb, sleep_hours: fc.constant(null) }),
  fc.record({ date: dateArb })
);

const rowArb = fc.oneof(valuedRowArb, emptyRowArb);

/** Independent reference: mean of the rows whose sleep_hours is a number. */
function expectedMean(rows: readonly DailyWearableRow[]): number | null {
  const values = rows
    .map((r) => r.sleep_hours)
    .filter((v): v is number => typeof v === "number");
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function expectMatches(actual: number | null, expected: number | null): void {
  if (expected === null) {
    expect(actual).toBeNull();
  } else {
    expect(actual).not.toBeNull();
    expect(Math.abs((actual as number) - expected)).toBeLessThanOrEqual(1e-9);
  }
}

describe("weeklySleepHours (Property 14: weekly sleep ignores missing days)", () => {
  it("is null with no valued day, otherwise the mean of exactly the valued days", () => {
    fc.assert(
      fc.property(fc.array(rowArb, { maxLength: 14 }), (rows) => {
        expectMatches(weeklySleepHours(rows), expectedMean(rows));
      }),
      { numRuns: 100 }
    );
  });

  it("is unchanged by inserting null or missing days anywhere", () => {
    fc.assert(
      fc.property(
        fc.array(rowArb, { maxLength: 14 }),
        fc.array(fc.record({ at: fc.nat(), row: emptyRowArb }), {
          maxLength: 10,
        }),
        (rows, insertions) => {
          const snapshot = structuredClone(rows);
          const before = weeklySleepHours(rows);

          const padded = [...rows];
          for (const { at, row } of insertions) {
            padded.splice(at % (padded.length + 1), 0, row);
          }
          const after = weeklySleepHours(padded);

          expectMatches(after, before);
          expect(rows).toEqual(snapshot);
        }
      ),
      { numRuns: 100 }
    );
  });
});
