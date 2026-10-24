// Feature: care-outputs, Task 5.3: unit tests for buildSummary.
//
// Maya's rows come from the generated synthetic history
// `data/synthetic/maya/weekly-features.json`; the other cases use small hand
// built histories and injected health-baseline functions. No I/O beyond
// importing the JSON.
//
// Validates: Requirements 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.1, 2.3, 2.4, 2.5, 3.1,
// 3.3, 4.2, 4.3, 4.4, 4.5
import { describe, expect, it } from "vitest";

import mayaWeekly from "@/data/synthetic/maya/weekly-features.json";
import { mayaDemoProfile } from "@/app/api/demo/start/route";
import { computeBaseline, recentMean, zScores, type WeeklyFeatureRow } from "@/lib/baseline";
import { detectSignal, gate } from "@/lib/signal";
import {
  NO_CHANGE_TEXT,
  NOT_A_DIAGNOSIS_FOOTER,
  SUMMARY_INTRO_TEXT,
  buildSummary,
  type ClinicianSummary,
  type SummaryDeps,
  type SummaryInput,
} from "@/lib/summary";

const REAL_DEPS: SummaryDeps = { detectSignal, gate, computeBaseline, zScores, recentMean };

const MAYA_ROWS: WeeklyFeatureRow[] = (mayaWeekly as Array<Record<string, unknown>>).map((r) => ({
  weekStart: r.week_start as string,
  vocabulary_diversity: r.vocabulary_diversity as number | null,
  mean_sentence_length: r.mean_sentence_length as number | null,
  filler_rate: r.filler_rate as number | null,
  sleep_hours: r.sleep_hours as number | null,
  active_minutes: r.active_minutes as number | null,
  twin_accuracy: r.twin_accuracy as number | null,
  synthetic: r.synthetic as boolean,
}));

/** `count` steady weeks from 2030-01-07, with small deterministic wobble. */
function steadyRows(count: number, synthetic = true): WeeklyFeatureRow[] {
  return Array.from({ length: count }, (_, i) => {
    const day = new Date(Date.UTC(2030, 0, 7 + 7 * i)).toISOString().slice(0, 10);
    const w = ((i * 7) % 5) / 100;
    return {
      weekStart: day,
      vocabulary_diversity: 0.7 + w,
      mean_sentence_length: 14 + w,
      filler_rate: 2.5 + w,
      sleep_hours: 7.2 + w,
      active_minutes: 300 + w * 100,
      twin_accuracy: 0.78 + w,
      synthetic,
    };
  });
}

function input(overrides: Partial<SummaryInput> = {}): SummaryInput {
  return {
    profile: { ...mayaDemoProfile(), familyHistoryRelation: "father" },
    rows: MAYA_ROWS,
    summaryDate: "2048-10-30",
    discussText: null,
    contact: null,
    ...overrides,
  };
}

function text(summary: ClinicianSummary, key: string): string {
  const field = summary.fields.find((f) => f.key === key);
  if (!field || !("text" in field)) throw new Error(`no text field ${key}`);
  return field.text;
}

function measures(summary: ClinicianSummary) {
  const field = summary.fields.find((f) => f.key === "measures");
  if (!field || !("rows" in field)) throw new Error("no measures field");
  return field.rows;
}

describe("buildSummary structure", () => {
  const summary = buildSummary(input());

  it("returns exactly the 14 fields in order (Req 1.2)", () => {
    expect(summary.fields.map((f) => f.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(summary.fields.map((f) => f.key)).toEqual([
      "subject",
      "intro",
      "person",
      "from",
      "focus",
      "family_history",
      "dates",
      "measures",
      "data_sources",
      "what_changed",
      "discuss",
      "rtk",
      "questions",
      "footer",
    ]);
  });

  it("uses the exact intro and footer (Req 1.5, 1.6)", () => {
    expect(text(summary, "intro")).toBe(
      "This summary was prepared by iamyou at the person's request, from their own conversations and wearable data. It is not a diagnosis and no clinician has reviewed it.",
    );
    expect(text(summary, "intro")).toBe(SUMMARY_INTRO_TEXT);
    expect(text(summary, "footer")).toBe("This is not a diagnosis.");
    expect(NOT_A_DIAGNOSIS_FOOTER).toBe("This is not a diagnosis.");
  });

  it("fills Maya's person, family history, dates and right-not-to-know fields", () => {
    expect(text(summary, "person")).toBe("Maya Linden, born 2008-03-14");
    expect(text(summary, "family_history")).toBe("Familial Alzheimer's disease (father)");
    expect(text(summary, "dates")).toBe("Baseline start: 2026-10-24 · Summary date: 2048-10-30");
    expect(text(summary, "rtk")).toBe(
      "The person chose to see changes and share them with their clinician.",
    );
  });

  it("passes discuss and contact through as written, with fallbacks", () => {
    expect(text(summary, "discuss")).toBe("Nothing added.");
    expect(text(summary, "from")).toBe("iamyou · iamyou.si · No contact chosen");
    expect(text(summary, "questions")).toBe("No contact chosen");

    const withInput = buildSummary(input({ discussText: "My sleep  lately.", contact: "maya@example.test" }));
    expect(text(withInput, "discuss")).toBe("My sleep  lately.");
    expect(text(withInput, "from")).toBe("iamyou · iamyou.si · maya@example.test");
    expect(text(withInput, "questions")).toBe("maya@example.test");
  });

  it("gives identical output on repeat and does not mutate its input (Req 1.7)", () => {
    const i = input();
    const before = JSON.stringify(i);
    expect(buildSummary(i)).toEqual(buildSummary(i));
    expect(JSON.stringify(i)).toBe(before);
  });
});

describe("buildSummary subject (Req 1.3, 1.4)", () => {
  it("is 'Change noticed' for Maya's drifting history with tell_me", () => {
    expect(detectSignal(MAYA_ROWS)).not.toBeNull();
    expect(text(buildSummary(input()), "subject")).toBe("iamyou Care Summary, Change noticed, M. Linden");
  });

  it("is 'Update' when the gate is closed", () => {
    const profile = { ...mayaDemoProfile(), rtkSetting: "record_only" as const };
    expect(text(buildSummary(input({ profile })), "subject")).toBe("iamyou Care Summary, Update, M. Linden");
  });

  it.each([
    [{ firstName: "Maya", lastName: null }, "M."],
    [{ firstName: null, lastName: "Linden" }, "Linden"],
    [{ firstName: "  ", lastName: "" }, "Name not provided"],
  ])("handles missing name parts %j", (names, short) => {
    const profile = { ...mayaDemoProfile(), rtkSetting: "record_only" as const, ...names };
    const summary = buildSummary(input({ profile }));
    expect(text(summary, "subject")).toBe(`iamyou Care Summary, Update, ${short}`);
    expect(summary.fields).toHaveLength(14);
  });
});

describe("buildSummary measures (Req 2)", () => {
  it("has six rows in order with no target key", () => {
    const rows = measures(buildSummary(input()));
    expect(rows.map((r) => r.feature)).toEqual([
      "vocabulary_diversity",
      "mean_sentence_length",
      "filler_rate",
      "sleep_hours",
      "active_minutes",
      "twin_accuracy",
    ]);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(["baselineMean", "feature", "label", "recentMean", "z"]);
    }
  });

  it("takes every value from the baseline modules (Req 2.5)", () => {
    const rows = measures(buildSummary(input()));
    const baseline = computeBaseline(MAYA_ROWS);
    const latest = zScores(MAYA_ROWS).at(-1);
    for (const row of rows) {
      expect(row.baselineMean).toBe(baseline[row.feature]?.mean ?? null);
      expect(row.recentMean).toBe(recentMean(MAYA_ROWS, row.feature, 4));
      expect(row.z).toBe(latest?.z[row.feature] ?? null);
      expect(row.z).not.toBeNull();
    }
  });

  it("shows no z-score with fewer than 12 weeks of data (Req 2.3)", () => {
    const rows = steadyRows(8);
    const summary = buildSummary(input({ rows }));
    for (const row of measures(summary)) {
      expect(row.z).toBeNull();
      expect(row.recentMean).not.toBeNull();
    }
  });

  it("shows nothing but 'No data yet' with no rows", () => {
    const summary = buildSummary(input({ rows: [] }));
    for (const row of measures(summary)) {
      expect(row).toMatchObject({ baselineMean: null, recentMean: null, z: null });
    }
    expect(text(summary, "dates")).toBe("Baseline start: No data yet · Summary date: 2048-10-30");
    expect(text(summary, "what_changed")).toBe(NO_CHANGE_TEXT);
  });
});

describe("buildSummary what changed (Req 3)", () => {
  const rows = steadyRows(40);
  const injected = (rtk: string): SummaryInput =>
    input({ rows, profile: { ...mayaDemoProfile(), rtkSetting: rtk as "tell_me" } });
  const signalDeps: SummaryDeps = {
    ...REAL_DEPS,
    detectSignal: () => ({
      features: ["sleep_hours", "vocabulary_diversity"],
      firstWeek: "2030-06-03",
      detectedWeek: "2030-06-17",
    }),
  };

  it("names only the signal's measures, the timeframe and z when open (Req 3.1, 3.3)", () => {
    const summary = buildSummary(injected("tell_me"), signalDeps);
    const changed = text(summary, "what_changed");
    const z = Object.fromEntries(measures(summary).map((r) => [r.feature, r.z]));

    expect(changed).toBe(
      "Since the week of 2030-06-03, 21 weeks after the baseline start on 2030-01-07, these measures " +
        "moved away from the person's own baseline: " +
        `Vocabulary diversity (z ${z.vocabulary_diversity?.toFixed(1)}, ${(z.vocabulary_diversity ?? 0) >= 0 ? "higher" : "lower"}); ` +
        `Sleep (z ${z.sleep_hours?.toFixed(1)}, ${(z.sleep_hours ?? 0) >= 0 ? "higher" : "lower"}).`,
    );
    for (const other of ["Mean sentence length", "Filler words", "Active minutes", "Twin accuracy"]) {
      expect(changed).not.toContain(other);
    }
    expect(text(summary, "subject")).toBe("iamyou Care Summary, Change noticed, M. Linden");
  });

  it("opens for doctor_only, the clinician summary being the one place it may appear", () => {
    expect(text(buildSummary(injected("doctor_only"), signalDeps), "what_changed")).not.toBe(NO_CHANGE_TEXT);
  });

  it("stays closed for record_only and unknown settings (Req 3.2)", () => {
    for (const rtk of ["record_only", "TELL_ME", ""]) {
      expect(text(buildSummary(injected(rtk), signalDeps), "what_changed")).toBe(NO_CHANGE_TEXT);
    }
  });

  it("stays closed when there is no signal or the gate cannot be read (Req 3.5)", () => {
    const noSignal = { ...REAL_DEPS, detectSignal: () => null };
    expect(text(buildSummary(injected("tell_me"), noSignal), "what_changed")).toBe(NO_CHANGE_TEXT);

    const throwing: SummaryDeps = {
      ...signalDeps,
      gate: () => {
        throw new Error("unreadable");
      },
    };
    expect(text(buildSummary(injected("tell_me"), throwing), "what_changed")).toBe(NO_CHANGE_TEXT);

    const nonBoolean = {
      ...signalDeps,
      gate: () => ({ showToUser: true, includeInSummary: "yes" }),
    } as unknown as SummaryDeps;
    expect(text(buildSummary(injected("tell_me"), nonBoolean), "what_changed")).toBe(NO_CHANGE_TEXT);
  });
});

describe("buildSummary synthetic and safe copy (Req 4)", () => {
  it("is synthetic for Maya and states it in field 9 (Req 4.2, 4.4)", () => {
    const summary = buildSummary(input());
    expect(summary.synthetic).toBe(true);
    expect(text(summary, "data_sources")).toBe(
      `${MAYA_ROWS.length} weeks of data from voice check-ins and a wearable. Includes synthetic data.`,
    );
  });

  it("is synthetic whenever a flag is not explicitly false (Req 4.3)", () => {
    const real = { ...mayaDemoProfile(), synthetic: false };
    expect(buildSummary(input({ profile: real, rows: steadyRows(3, false) })).synthetic).toBe(false);
    expect(
      text(buildSummary(input({ profile: real, rows: steadyRows(3, false) })), "data_sources"),
    ).toBe("3 weeks of data from voice check-ins and a wearable. No synthetic data.");

    const unknownProfile = { ...real, synthetic: undefined as unknown as boolean };
    expect(buildSummary(input({ profile: unknownProfile, rows: steadyRows(3, false) })).synthetic).toBe(true);

    const oneUnknownRow = steadyRows(3, false).map((r, i) =>
      i === 1 ? { ...r, synthetic: null as unknown as boolean } : r,
    );
    expect(buildSummary(input({ profile: real, rows: oneUnknownRow })).synthetic).toBe(true);
    expect(buildSummary(input({ profile: real, rows: steadyRows(3, true) })).synthetic).toBe(true);
  });

  it("names a condition only in field 6 and uses no likelihood or diagnosis wording (Req 3.3, 4.5)", () => {
    const summaries = [
      buildSummary(input()),
      buildSummary(input({ profile: { ...mayaDemoProfile(), rtkSetting: "record_only" } })),
    ];
    for (const summary of summaries) {
      for (const field of summary.fields) {
        const content = "text" in field ? field.text : JSON.stringify(field.rows);
        if (field.key !== "family_history") {
          expect(content).not.toMatch(/alzheimer|huntington|amyotrophic|\bALS\b|dementia/i);
        }
        expect(content).not.toMatch(/likely|risk|diagnosed/i);
      }
    }
  });
});
