// Feature: care-outputs, Property 3: A closed gate hides change details
// Validates: Requirements 3.2, 3.4, 3.5
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { computeBaseline, recentMean, zScores, type Feature, type WeeklyFeatureRow } from "@/lib/baseline";
import type { RtkSetting } from "@/lib/db/vault-repository";
import { detectSignal, gate, type ChangeSignal } from "@/lib/signal";
import { NO_CHANGE_TEXT, SUMMARY_FEATURE_ORDER, buildSummary, type SummaryDeps } from "@/lib/summary";

/** Text that only the open "What changed" template produces. */
const CHANGE_MARKER = "moved away from the person's own baseline";

const valueArb = fc.option(fc.double({ min: 0, max: 400, noNaN: true }), { nil: null });

/** Chronological weekly rows from 2030-01-07, values or explicit nulls. */
const rowsArb: fc.Arbitrary<WeeklyFeatureRow[]> = fc
  .array(
    fc.record({
      vocabulary_diversity: valueArb,
      mean_sentence_length: valueArb,
      filler_rate: valueArb,
      sleep_hours: valueArb,
      active_minutes: valueArb,
      twin_accuracy: valueArb,
      synthetic: fc.boolean(),
    }),
    { maxLength: 30 },
  )
  .map((rows) =>
    rows.map((row, i) => ({
      weekStart: new Date(Date.UTC(2030, 0, 7 + 7 * i)).toISOString().slice(0, 10),
      ...row,
    })),
  );

const signalArb: fc.Arbitrary<ChangeSignal> = fc.record({
  features: fc.subarray([...SUMMARY_FEATURE_ORDER] as Feature[], { minLength: 1 }),
  firstWeek: fc.constantFrom("2030-03-04", "2031-01-06"),
  detectedWeek: fc.constant("2031-02-03"),
});

/** Every gate outcome that is not exactly `includeInSummary: true`. */
const closedGateArb: fc.Arbitrary<SummaryDeps["gate"]> = fc.oneof(
  fc.constant(() => ({ showToUser: true, includeInSummary: false })),
  fc
    .oneof(fc.string(), fc.integer(), fc.constant(null), fc.constant(undefined), fc.constant("true"), fc.constant(1))
    .map((v) => () => ({ showToUser: true, includeInSummary: v }) as unknown as ReturnType<typeof gate>),
  fc.constant(() => undefined as unknown as ReturnType<typeof gate>),
  fc.constant(() => {
    throw new Error("gate unreadable");
  }),
);

const rtkArb = fc.constantFrom<RtkSetting>("tell_me", "doctor_only", "record_only");

function expectClosed(summary: ReturnType<typeof buildSummary>): void {
  const whatChanged = summary.fields.find((f) => f.key === "what_changed");
  const subject = summary.fields.find((f) => f.key === "subject");
  expect(whatChanged && "text" in whatChanged ? whatChanged.text : null).toBe(NO_CHANGE_TEXT);
  expect(subject && "text" in subject ? subject.text : "").toMatch(/^iamyou Care Summary, Update, /);
  for (const field of summary.fields) {
    const content = "text" in field ? field.text : JSON.stringify(field.rows);
    expect(content).not.toContain(CHANGE_MARKER);
  }
}

const profile = (rtkSetting: unknown) => ({
  firstName: "Maya",
  lastName: "Linden",
  dateOfBirth: "2008-03-14",
  familyHistory: "familial_alzheimers" as const,
  familyHistoryRelation: "father",
  rtkSetting: rtkSetting as RtkSetting,
  synthetic: true,
});

describe("buildSummary (Property 3)", () => {
  it("hides change details for any signal and any gate outcome that is not exactly true", () => {
    fc.assert(
      fc.property(rowsArb, fc.option(signalArb, { nil: null }), closedGateArb, rtkArb, (rows, signal, closedGate, rtk) => {
        const deps: SummaryDeps = {
          detectSignal: () => signal,
          gate: closedGate,
          computeBaseline,
          zScores,
          recentMean,
        };
        expectClosed(
          buildSummary({ profile: profile(rtk), rows, summaryDate: "2031-03-01", discussText: null, contact: null }, deps),
        );
      }),
      { numRuns: 150 },
    );
  });

  it("hides change details with a null signal, whatever the gate says", () => {
    fc.assert(
      fc.property(rowsArb, rtkArb, (rows, rtk) => {
        const deps: SummaryDeps = {
          detectSignal: () => null,
          gate: () => ({ showToUser: true, includeInSummary: true }),
          computeBaseline,
          zScores,
          recentMean,
        };
        expectClosed(
          buildSummary({ profile: profile(rtk), rows, summaryDate: "2031-03-01", discussText: null, contact: null }, deps),
        );
      }),
      { numRuns: 100 },
    );
  });

  it("with the real gate, hides change details for record_only and every value outside the three settings", () => {
    fc.assert(
      fc.property(
        rowsArb,
        signalArb,
        fc.oneof(
          fc.constant<unknown>("record_only"),
          fc.anything().filter((v) => v !== "tell_me" && v !== "doctor_only"),
        ),
        (rows, signal, rtk) => {
          const deps: SummaryDeps = { detectSignal: () => signal, gate, computeBaseline, zScores, recentMean };
          expectClosed(
            buildSummary({ profile: profile(rtk), rows, summaryDate: "2031-03-01", discussText: null, contact: null }, deps),
          );
        },
      ),
      { numRuns: 150 },
    );
  });

  it("with every real health-baseline function, record_only never shows a change", () => {
    fc.assert(
      fc.property(rowsArb, (rows) => {
        expectClosed(
          buildSummary(
            { profile: profile("record_only"), rows, summaryDate: "2031-03-01", discussText: null, contact: null },
            { detectSignal, gate, computeBaseline, zScores, recentMean },
          ),
        );
      }),
      { numRuns: 100 },
    );
  });
});
