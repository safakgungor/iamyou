// Feature: health-baseline, Property 2: `record_only` hides everywhere
//
// Validates: Requirements 5.4
//
// gate(signal, rtk_setting) is the right-not-to-know gate in lib/signal.ts. For any
// change signal, including null, this property asserts that `record_only` returns
// exactly { showToUser: false, includeInSummary: false }: the signal is neither shown
// to the user nor included in the clinician summary.
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { FEATURES } from "@/lib/baseline";
import { gate, type ChangeSignal, type GateResult } from "@/lib/signal";

const MS_PER_DAY = 86_400_000;
const MIN_DAY = Date.UTC(2020, 0, 1) / MS_PER_DAY;
const MAX_DAY = Date.UTC(2030, 11, 31) / MS_PER_DAY;

/** An ISO `YYYY-MM-DD` date string for a whole UTC day number. */
function isoDate(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

// A well-formed change signal: at least FEATURES_REQUIRED (2) features in canonical
// FEATURES order (`fc.subarray` preserves source order), and ISO dates with
// firstWeek <= detectedWeek. `fc.option` adds `null` (no signal). Shared by every
// property in this file (P2, P3, P7).
const changeSignalArb: fc.Arbitrary<ChangeSignal | null> = fc.option(
  fc
    .record({
      features: fc.subarray([...FEATURES], { minLength: 2 }),
      days: fc.tuple(
        fc.integer({ min: MIN_DAY, max: MAX_DAY }),
        fc.integer({ min: MIN_DAY, max: MAX_DAY })
      ),
    })
    .map(({ features, days: [a, b] }) => ({
      features,
      firstWeek: isoDate(Math.min(a, b)),
      detectedWeek: isoDate(Math.max(a, b)),
    }))
);

describe("gate (right-not-to-know)", () => {
  it("Property 2: record_only hides everywhere for any signal", () => {
    fc.assert(
      fc.property(changeSignalArb, (signal) => {
        const result: GateResult = gate(signal, "record_only");
        expect(result).toStrictEqual({ showToUser: false, includeInSummary: false });
      }),
      { numRuns: 100 }
    );
  });

  // Feature: health-baseline, Property 3: `doctor_only` hides from the user
  //
  // Validates: Requirements 5.3
  //
  // For any change signal, including null, `doctor_only` returns exactly
  // { showToUser: false, includeInSummary: true }: the signal is never shown to the
  // user but still reaches the clinician summary.
  it("Property 3: doctor_only hides from the user for any signal", () => {
    fc.assert(
      fc.property(changeSignalArb, (signal) => {
        const result: GateResult = gate(signal, "doctor_only");
        expect(result).toStrictEqual({ showToUser: false, includeInSummary: true });
      }),
      { numRuns: 100 }
    );
  });

  // Feature: health-baseline, Property 7: The gate is total and fails closed
  //
  // Validates: Requirements 5.1, 5.2, 5.5
  //
  // For any change signal, including null, and any value `s`: exactly `'tell_me'`
  // returns { showToUser: true, includeInSummary: true }; any value that is not one of
  // the three settings returns { showToUser: false, includeInSummary: false }; gate
  // never throws. The generator mixes the three exact settings (so the open branches
  // run), near-miss strings, string-like objects that coerce to 'tell_me' (these must
  // fail closed because the gate compares by identity, not coercion), and fc.anything().
  it("Property 7: the gate is total and fails closed for any setting value", () => {
    const exactSettingArb = fc.constantFrom("tell_me", "doctor_only", "record_only");
    const nearMissStringArb = fc.constantFrom(
      "TELL_ME",
      " tell_me",
      "tell_me ",
      "Tell_Me",
      "tell-me",
      "",
      "DOCTOR_ONLY",
      " record_only"
    );
    const stringLikeArb = fc.constantFrom<unknown>(
      new String("tell_me"),
      { toString: () => "tell_me" },
      { valueOf: () => "tell_me" },
      { [Symbol.toPrimitive]: () => "tell_me" },
      ["tell_me"]
    );
    const settingArb = fc.oneof(
      exactSettingArb,
      nearMissStringArb,
      stringLikeArb,
      fc.anything()
    );

    fc.assert(
      fc.property(changeSignalArb, settingArb, (signal, setting) => {
        let result: GateResult | undefined;
        expect(() => {
          result = gate(signal, setting);
        }).not.toThrow();

        if (setting === "tell_me") {
          expect(result).toStrictEqual({ showToUser: true, includeInSummary: true });
        } else if (setting === "doctor_only") {
          expect(result).toStrictEqual({ showToUser: false, includeInSummary: true });
        } else {
          // record_only and every value that is not one of the three settings.
          expect(result).toStrictEqual({ showToUser: false, includeInSummary: false });
        }
      }),
      { numRuns: 200 }
    );
  });
});
