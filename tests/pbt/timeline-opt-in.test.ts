// Feature: health-baseline, Property 18: Opted-out callers get nothing
//
// Validates: Requirements 9.1, 9.2, 9.4
//
// For any caller whose profile is absent or has `healthLayerOptIn` other than
// exactly `true` (`false`, `null`, `undefined`, a missing key, or a near miss
// such as `"true"` or `1`), any `rtk_setting` (the three settings, near misses,
// or fc.anything()), and any weekly rows stored for that caller (messy
// distinct-week histories that may be empty, or `driftArb` histories that
// always raise a change signal) in a `countingWeeklyRepo` over
// `InMemoryWeeklyFeatureRepository`, `getTimeline(weekly, profiles, userId)`:
//
// - returns status 200;
// - with a body that deep-equals `{ opted_in: false }`;
// - whose JSON is exactly `{"opted_in":false}`;
// - and `listWeeklyFeatures` was called 0 times (the rows were never read).
//
// `false` profiles go through the real `InMemoryVaultRepository`. Values the
// `Profile` type does not allow (`null`, `undefined`, missing key, non-boolean)
// are served by a small stub `ProfileReader` returning the cast profile object,
// so no production type is weakened. A run-level counter guards against a
// vacuous pass: drift histories, non-empty stored rows, and every profile kind
// must all occur.
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  InMemoryVaultRepository,
  type FamilyHistory,
  type Profile,
} from "@/lib/db/vault-repository";
import { InMemoryWeeklyFeatureRepository } from "@/lib/db/weekly-feature-repository";
import type { WeeklyFeatureRow } from "@/lib/baseline";
import { getTimeline, type ProfileReader } from "@/app/api/timeline/route";
import { countingWeeklyRepo, driftArb, storedWeeklyRowsArb } from "./helpers/weekly-rows";

/* -------------------------------------------------------------------------- */
/* Generators                                                                 */
/* -------------------------------------------------------------------------- */

const familyHistoryArb: fc.Arbitrary<FamilyHistory> = fc.constantFrom(
  "huntington",
  "familial_alzheimers",
  "als",
  "none",
  "prefer_not",
);

/** The three settings, near misses that must not count, or anything at all. */
const rtkSettingArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.constantFrom<unknown>("tell_me", "doctor_only", "record_only"),
  fc.constantFrom<unknown>(null, undefined, "", "Tell_me", " tell_me", "TELL_ME", "doctor-only"),
  fc.anything(),
);

/** Every profile field except the two under test (opt-in and rtk_setting). */
const profileRestArb = fc.record({
  firstName: fc.option(fc.string(), { nil: null }),
  lastName: fc.option(fc.string(), { nil: null }),
  dateOfBirth: fc.option(fc.string(), { nil: null }),
  county: fc.option(fc.string(), { nil: null }),
  familyHistory: familyHistoryArb,
  digitalWill: fc.option(fc.jsonValue(), { nil: null }),
  synthetic: fc.boolean(),
});

/** How the caller is opted out. */
type OptOutKind = "absent" | "false" | "null" | "undefined" | "missingKey" | "nearMiss";

type CallerProfile =
  | { kind: "absent" }
  | { kind: Exclude<OptOutKind, "absent">; profile: Record<string, unknown> };

/** Values that are not exactly `true` and are not booleans either. */
const nearMissOptInArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.constantFrom<unknown>("true", 1, "yes", [true], { value: true }, Number.NaN),
  fc.anything().filter((v) => v !== true && typeof v !== "boolean"),
);

const callerProfileArb: fc.Arbitrary<CallerProfile> = fc.oneof(
  fc.constant<CallerProfile>({ kind: "absent" }),
  fc
    .tuple(
      fc.constantFrom<Exclude<OptOutKind, "absent">>(
        "false",
        "null",
        "undefined",
        "missingKey",
        "nearMiss",
      ),
      profileRestArb,
      rtkSettingArb,
      nearMissOptInArb,
    )
    .map(([kind, rest, rtkSetting, nearMiss]): CallerProfile => {
      const profile: Record<string, unknown> = { ...rest, rtkSetting };
      switch (kind) {
        case "false":
          profile.healthLayerOptIn = false;
          break;
        case "null":
          profile.healthLayerOptIn = null;
          break;
        case "undefined":
          profile.healthLayerOptIn = undefined;
          break;
        case "missingKey":
          break; // key left out
        case "nearMiss":
          profile.healthLayerOptIn = nearMiss;
          break;
      }
      return { kind, profile };
    }),
);

/** Distinct weeks (possibly empty, possibly enough for a baseline) or a signalling drift. */
const historyArb: fc.Arbitrary<{ drift: boolean; rows: WeeklyFeatureRow[] }> = fc.oneof(
  storedWeeklyRowsArb().map((rows) => ({ drift: false, rows })),
  driftArb.map((rows) => ({ drift: true, rows })),
);

const userIdArb = fc.string({ minLength: 1, maxLength: 12 });

/* -------------------------------------------------------------------------- */
/* Profile readers                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The profile reader for the caller. `absent` and `false` use the real
 * in-memory vault repository; the other kinds are not valid `Profile`s, so a
 * stub returns the cast object for the caller only.
 */
async function profilesFor(caller: CallerProfile, userId: string): Promise<ProfileReader> {
  if (caller.kind === "absent") return new InMemoryVaultRepository();
  if (caller.kind === "false") {
    const repo = new InMemoryVaultRepository();
    await repo.upsertProfile(userId, caller.profile as Profile);
    return repo;
  }
  const stored = caller.profile as unknown as Profile;
  return {
    async getProfile(id: string) {
      return id === userId ? stored : null;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Property                                                                   */
/* -------------------------------------------------------------------------- */

describe("Property 18: Opted-out callers get nothing (Requirements 9.1, 9.2, 9.4)", () => {
  it("returns 200 and exactly {\"opted_in\":false} without reading any weekly rows", async () => {
    const seen = new Set<string>();

    await fc.assert(
      fc.asyncProperty(callerProfileArb, historyArb, userIdArb, async (caller, history, userId) => {
        const inner = new InMemoryWeeklyFeatureRepository();
        await inner.upsertWeeklyFeatures(userId, history.rows);
        const weekly = countingWeeklyRepo(inner);
        const profiles = await profilesFor(caller, userId);

        seen.add(caller.kind);
        if (history.drift) seen.add("drift");
        if (history.rows.length > 0) seen.add("nonEmptyRows");

        const outcome = await getTimeline(weekly, profiles, userId);

        expect(outcome.status).toBe(200);
        expect(outcome.body).toEqual({ opted_in: false });
        expect(JSON.stringify(outcome.body)).toBe('{"opted_in":false}');
        expect(weekly.listCalls).toBe(0);

        // The rows really were there to leak; the route just never read them.
        expect(await inner.listWeeklyFeatures(userId)).toHaveLength(
          new Set(history.rows.map((r) => r.weekStart)).size,
        );
      }),
      { numRuns: 200 },
    );

    for (const tag of [
      "absent",
      "false",
      "null",
      "undefined",
      "missingKey",
      "nearMiss",
      "drift",
      "nonEmptyRows",
    ]) {
      expect(seen.has(tag), `no run covered ${tag}`).toBe(true);
    }
  });
});
