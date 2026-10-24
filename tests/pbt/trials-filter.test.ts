// Feature: care-outputs, Property 1: Filtered trials are recruiting and Massachusetts-anchored
// Validates: Requirements 8.1, 8.2, 8.3, 8.4, 6.3, 6.4
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { filterTrials, normalizeTrial, type Trial } from "@/lib/trials";

/** Recursively freezes a value so any mutation throws in strict mode. */
function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

const stateArb = fc.oneof(
  fc.constantFrom("Massachusetts", "massachusetts", " MASSACHUSETTS ", "New York", "Maine", "", null),
  fc.string(),
);

const locationArb = fc.record(
  {
    city: fc.oneof(fc.string(), fc.constant(null), fc.constant("Boston")),
    state: stateArb,
  },
  { requiredKeys: [] },
);

const statusArb = fc.oneof(
  fc.constantFrom("RECRUITING", "recruiting", "COMPLETED", "NOT_YET_RECRUITING", "", null),
  fc.string(),
);

/** Raw API v2 studies, including partial and malformed shapes. */
const rawLiveArb: fc.Arbitrary<unknown> = fc.oneof(
  {
    weight: 8,
    arbitrary: fc.record({
      protocolSection: fc.record(
        {
          identificationModule: fc.record({
            nctId: fc.oneof(fc.string(), fc.constant(null)),
            briefTitle: fc.oneof(fc.string(), fc.constant(null)),
          }),
          statusModule: fc.record({ overallStatus: statusArb }),
          conditionsModule: fc.record({
            conditions: fc.oneof(fc.array(fc.oneof(fc.string(), fc.constant(null))), fc.constant(null)),
          }),
          designModule: fc.record({
            phases: fc.oneof(fc.array(fc.constantFrom("PHASE1", "PHASE2", "NA", "X")), fc.constant(null)),
          }),
          contactsLocationsModule: fc.record({
            locations: fc.oneof(fc.array(locationArb, { maxLength: 6 }), fc.constant(null)),
          }),
        },
        { requiredKeys: [] },
      ),
    }),
  },
  { weight: 1, arbitrary: fc.anything() },
);

/** Raw saved-slice rows, with arbitrary status and city columns. */
const rawSliceArb: fc.Arbitrary<unknown> = fc.record({
  nct_id: fc.string(),
  title: fc.string(),
  phase: fc.string(),
  conditions: fc.string(),
  massachusetts_city: fc.string(),
  status: fc.string(),
});

/** The test's own oracle: did this raw study have a recruiting status and a Massachusetts location? */
function isRecruitingInMassachusetts(raw: unknown): boolean {
  const protocol = (raw as { protocolSection?: Record<string, unknown> } | null)?.protocolSection;
  if (typeof protocol !== "object" || protocol === null) return false;
  const status = (protocol.statusModule as { overallStatus?: unknown } | undefined)?.overallStatus;
  if (typeof status !== "string" || status.trim() !== "RECRUITING") return false;
  const locations = (protocol.contactsLocationsModule as { locations?: unknown } | undefined)?.locations;
  if (!Array.isArray(locations)) return false;
  return locations.some((location) => {
    const state = (location as { state?: unknown } | null)?.state;
    return typeof state === "string" && state.trim().toLowerCase() === "massachusetts";
  });
}

const trialArb: fc.Arbitrary<Trial> = fc.record({
  nctId: fc.string(),
  title: fc.string(),
  phaseLabel: fc.string(),
  conditions: fc.array(fc.string(), { maxLength: 4 }),
  status: fc.oneof(fc.constantFrom("RECRUITING", "recruiting", "COMPLETED", ""), fc.string()),
  cities: fc.array(fc.string(), { maxLength: 4 }),
  source: fc.constantFrom("live", "saved_ma_slice", "other") as fc.Arbitrary<Trial["source"]>,
});

describe("normalizeTrial + filterTrials (Property 1)", () => {
  it("returns exactly the recruiting Massachusetts studies, slice rows anchored to Massachusetts", () => {
    fc.assert(
      fc.property(
        fc.array(rawLiveArb, { maxLength: 15 }),
        fc.array(rawSliceArb, { maxLength: 15 }),
        (rawLive, rawSlice) => {
          deepFreeze(rawLive);
          deepFreeze(rawSlice);
          const before = JSON.stringify([rawLive, rawSlice]);

          const live = rawLive.map((raw) => normalizeTrial(raw, "live"));
          const slice = rawSlice.map((raw) => normalizeTrial(raw, "saved_ma_slice"));
          const input = deepFreeze([...live, ...slice]);
          const result = filterTrials(input);

          // Every returned trial is RECRUITING. (Req 8.1)
          for (const t of result) expect(t.status).toBe("RECRUITING");

          // Live trials: exactly those whose raw study was recruiting with a
          // Massachusetts location, in input order. (Req 8.2, 8.3)
          const expectedLive = live.filter((_, i) => isRecruitingInMassachusetts(rawLive[i]));
          expect(result.filter((t) => t.source === "live")).toEqual(expectedLive);

          // Slice trials: every row kept, RECRUITING, cities ["Massachusetts"]. (Req 6.3, 6.4, 8.4)
          const resultSlice = result.filter((t) => t.source === "saved_ma_slice");
          expect(resultSlice).toHaveLength(rawSlice.length);
          for (const t of resultSlice) expect(t.cities).toEqual(["Massachusetts"]);

          // No mutation, and identical output on repeat. (Req 8.1)
          expect(JSON.stringify([rawLive, rawSlice])).toBe(before);
          expect(filterTrials(input)).toEqual(result);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("holds the same invariants over arbitrary Trial values", () => {
    fc.assert(
      fc.property(fc.array(trialArb, { maxLength: 20 }), (trials) => {
        const input = deepFreeze(trials.map((t) => ({ ...t })));
        const result = filterTrials(input);

        for (const t of result) {
          expect(t.status).toBe("RECRUITING");
          expect(["live", "saved_ma_slice"]).toContain(t.source);
          if (t.source === "live") expect(t.cities.length).toBeGreaterThan(0);
          if (t.source === "saved_ma_slice") expect(t.cities).toEqual(["Massachusetts"]);
        }

        const expectedCount = trials.filter(
          (t) =>
            t.status === "RECRUITING" &&
            (t.source === "saved_ma_slice" || (t.source === "live" && t.cities.length > 0)),
        ).length;
        expect(result).toHaveLength(expectedCount);
        expect(filterTrials(input)).toEqual(result);
      }),
      { numRuns: 200 },
    );
  });
});
