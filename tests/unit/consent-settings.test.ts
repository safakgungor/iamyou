// Feature: twin-loop, Req 2: consent & settings screen helpers.
//
// The screen at /onboarding prefills from the caller's profile and, on save,
// writes only the choices that changed. These tests cover the pure helpers in
// `components/settings/consent.ts` that make that true:
//   - with no profile the form starts from the Req 2 defaults (health layer
//     off, `record_only`) and saving stores exactly those (Req 2.2, 2.4);
//   - with a profile the form starts from it, and the saved row differs from
//     the stored one only in the changed choices, so a demo save never resets
//     Maya's name, digital will or synthetic flag (property, fast-check);
//   - the copy keeps the Req 2.6 / 2.7 wording rules.
//
// Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.6, 2.7
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  DEFAULT_SETTINGS,
  DOCTOR_WORDING,
  FAMILY_HISTORY_OPTIONS,
  RTK_OPTIONS,
  changedSettings,
  profileToSave,
  settingsFrom,
  type ConsentSettings,
} from "@/components/settings/consent";
import {
  InMemoryVaultRepository,
  type FamilyHistory,
  type Profile,
  type RtkSetting,
} from "@/lib/db/vault-repository";

const FAMILY_HISTORIES: FamilyHistory[] = ["huntington", "familial_alzheimers", "als", "none", "prefer_not"];
const RTK_SETTINGS: RtkSetting[] = ["tell_me", "doctor_only", "record_only"];

/** Maya's profile as the demo seeds it. */
function maya(): Profile {
  return {
    firstName: "Maya",
    lastName: "Linden",
    dateOfBirth: "2008-03-14",
    county: "Hampshire",
    familyHistory: "familial_alzheimers",
    healthLayerOptIn: true,
    rtkSetting: "tell_me",
    digitalWill: { family_mode_access: ["Ella Linden (daughter)"], decided_at_age: 31 },
    synthetic: true,
  };
}

const settingsArb: fc.Arbitrary<ConsentSettings> = fc.record({
  familyHistory: fc.constantFrom(...FAMILY_HISTORIES),
  healthLayerOptIn: fc.boolean(),
  rtkSetting: fc.constantFrom(...RTK_SETTINGS),
});

describe("consent settings: defaults and prefill", () => {
  it("starts a user with no profile from the Req 2 defaults", () => {
    expect(settingsFrom(null)).toEqual({
      familyHistory: "none",
      healthLayerOptIn: false,
      rtkSetting: "record_only",
    });
    expect(settingsFrom(null)).toEqual(DEFAULT_SETTINGS);
  });

  it("stores exactly the defaults when a new user changes nothing", () => {
    const saved = profileToSave(null, settingsFrom(null), {});
    expect(saved.healthLayerOptIn).toBe(false);
    expect(saved.rtkSetting).toBe("record_only");
    expect(FAMILY_HISTORIES).toContain(saved.familyHistory);
    expect(saved.synthetic).toBe(false);
    expect(saved.digitalWill).toBeNull();
  });

  it("prefills from an existing profile", () => {
    expect(settingsFrom(maya())).toEqual({
      familyHistory: "familial_alzheimers",
      healthLayerOptIn: true,
      rtkSetting: "tell_me",
    });
  });
});

describe("consent settings: saving writes only what changed", () => {
  it("reports no changes when nothing moved", () => {
    const initial = settingsFrom(maya());
    expect(changedSettings(initial, { ...initial })).toEqual({});
  });

  it("changes only the right-not-to-know setting and keeps the rest of Maya's row", async () => {
    const repo = new InMemoryVaultRepository();
    await repo.upsertProfile("maya", maya());

    const stored = await repo.getProfile("maya");
    const initial = settingsFrom(stored);
    const current: ConsentSettings = { ...initial, rtkSetting: "doctor_only" };
    const changes = changedSettings(initial, current);
    expect(changes).toEqual({ rtkSetting: "doctor_only" });

    await repo.upsertProfile("maya", profileToSave(stored, current, changes));
    expect(await repo.getProfile("maya")).toEqual({ ...maya(), rtkSetting: "doctor_only" });
  });

  it("property: the saved row differs from the stored row only in changed choices", () => {
    fc.assert(
      fc.property(settingsArb, settingsArb, settingsArb, (storedChoices, initial, current) => {
        // `stored` may have moved on since the form opened (another tab).
        const stored: Profile = { ...maya(), ...storedChoices };
        const changes = changedSettings(initial, current);
        const saved = profileToSave(stored, current, changes);

        for (const key of Object.keys(stored) as Array<keyof Profile>) {
          if (key in changes) {
            expect(saved[key]).toEqual(current[key as keyof ConsentSettings]);
          } else {
            expect(saved[key]).toEqual(stored[key]);
          }
        }
      })
    );
  });
});

describe("consent settings: copy (Req 2.6, 2.7)", () => {
  it("names who hears about a change", () => {
    expect(RTK_OPTIONS.map((o) => [o.value, o.label])).toEqual([
      ["tell_me", "Me"],
      ["doctor_only", "Only my doctor"],
      ["record_only", "No one"],
    ]);
  });

  it("offers every family-history value exactly once", () => {
    expect(FAMILY_HISTORY_OPTIONS.map((o) => o.value).sort()).toEqual([...FAMILY_HISTORIES].sort());
  });

  it("keeps the approved doctor sentence verbatim", () => {
    expect(DOCTOR_WORDING).toBe("You might want to talk to your doctor about this.");
  });

  it("never states or implies the user has or is likely to have a condition", () => {
    const copy = [
      ...FAMILY_HISTORY_OPTIONS.map((o) => o.label),
      ...RTK_OPTIONS.flatMap((o) => [o.label, o.detail]),
    ].join(" ");
    expect(copy).not.toMatch(/\b(you have|you may have|likely|at risk|risk of|diagnos|symptom|carrier)/i);
  });
});
