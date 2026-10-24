// Feature: care-outputs, Task 2.4: unit tests for lib/trials.ts.
//
// Covers the phase table (every value in the saved slice plus the API array
// form), keyword matching including whole-word ALS, live and slice
// normalization, the RFC 4180 CSV parser on quoted titles and on the real
// saved slice, and the two URL helpers.
//
// Validates: Requirements 6.2, 6.3, 6.4, 7.2, 7.3, 7.4, 7.5, 7.6, 8.5, 8.6
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  conditionSearchUrl,
  filterTrials,
  matchesCondition,
  normalizeTrial,
  parseSliceCsv,
  phaseLabel,
  studyUrl,
  type Trial,
} from "@/lib/trials";

const SLICE_PATH = fileURLToPath(
  new URL("../../data/public/clinicaltrials-ma-recruiting-2026-10-18.csv", import.meta.url),
);

function trial(overrides: Partial<Trial>): Trial {
  return {
    nctId: "NCT00000001",
    title: "",
    phaseLabel: "Phase not listed",
    conditions: [],
    status: "RECRUITING",
    cities: ["Massachusetts"],
    source: "saved_ma_slice",
    ...overrides,
  };
}

/** A minimal ClinicalTrials.gov API v2 study in the shape the route requests. */
function liveStudy(locations: unknown): unknown {
  return {
    protocolSection: {
      identificationModule: { nctId: "NCT05555555", briefTitle: "A Study of Memory in Adults" },
      statusModule: { overallStatus: "RECRUITING" },
      conditionsModule: { conditions: ["Alzheimer Disease", "  ", "Memory"] },
      designModule: { phases: ["PHASE2", "PHASE3"] },
      contactsLocationsModule: { locations },
    },
  };
}

describe("phaseLabel", () => {
  it.each([
    ["NA", "Not a drug trial"],
    ["", "Phase not listed"],
    ["EARLY_PHASE1", "Early phase 1: very first small tests in people"],
    ["PHASE1", "Phase 1: first tests in people"],
    ["PHASE2", "Phase 2: testing whether it works and is safe"],
    ["PHASE3", "Phase 3: comparing it with standard care in more people"],
    ["PHASE4", "Phase 4: studying it after approval"],
    [
      "PHASE1, PHASE2",
      "Phase 1: first tests in people / Phase 2: testing whether it works and is safe",
    ],
    [
      "PHASE2, PHASE3",
      "Phase 2: testing whether it works and is safe / Phase 3: comparing it with standard care in more people",
    ],
  ])("labels the slice value %j exactly (Req 7.3, 7.4, 7.5)", (raw, label) => {
    expect(phaseLabel(raw)).toBe(label);
  });

  it("labels the API array form like the CSV form (Req 7.5)", () => {
    expect(phaseLabel(["PHASE1", "PHASE2"])).toBe(phaseLabel("PHASE1, PHASE2"));
    expect(phaseLabel(["NA"])).toBe("Not a drug trial");
  });

  it("falls back to one label for blank, absent and unknown values (Req 7.6)", () => {
    for (const raw of ["   ", undefined, null, 3, {}, [], ["PHASE9"], "phase one"]) {
      expect(phaseLabel(raw)).toBe("Phase not listed");
    }
  });

  it("skips unknown tokens and dedupes known ones in input order (Req 7.5)", () => {
    expect(phaseLabel(" phase2 ,PHASE9, PHASE1, phase2")).toBe(
      "Phase 2: testing whether it works and is safe / Phase 1: first tests in people",
    );
  });
});

describe("matchesCondition", () => {
  it("matches huntington and alzheimer keywords in conditions or title (Req 6.2)", () => {
    expect(matchesCondition(trial({ conditions: ["Huntington Disease"] }), "huntington")).toBe(true);
    expect(matchesCondition(trial({ title: "Early ALZHEIMER'S care" }), "familial_alzheimers")).toBe(
      true,
    );
    expect(matchesCondition(trial({ conditions: ["Parkinson Disease"] }), "huntington")).toBe(false);
  });

  it("matches ALS by full name, motor neuron, or the whole word only (Req 6.2)", () => {
    expect(matchesCondition(trial({ conditions: ["Amyotrophic Lateral Sclerosis"] }), "als")).toBe(
      true,
    );
    expect(matchesCondition(trial({ conditions: ["Motor Neuron Disease"] }), "als")).toBe(true);
    expect(matchesCondition(trial({ title: "Breathing support in ALS" }), "als")).toBe(true);
    expect(matchesCondition(trial({ conditions: ["ALS-FTD"] }), "als")).toBe(true);
    expect(matchesCondition(trial({ title: "It also deals with falls" }), "als")).toBe(false);
  });

  it("never matches a condition without a keyword mapping (Req 6.5)", () => {
    const t = trial({ conditions: ["Alzheimer Disease", "Huntington Disease", "ALS"] });
    for (const condition of ["none", "prefer_not", "", undefined, null]) {
      expect(matchesCondition(t, condition)).toBe(false);
    }
  });
});

describe("normalizeTrial", () => {
  it("keeps only Massachusetts cities from a live study (Req 7.1)", () => {
    const normalized = normalizeTrial(
      liveStudy([
        { city: "Boston", state: "Massachusetts" },
        { city: "New York", state: "New York" },
        { city: " Worcester ", state: " massachusetts " },
        { city: "Boston", state: "MASSACHUSETTS" },
        { city: "", state: "Massachusetts" },
        { city: "Providence", state: null },
      ]),
      "live",
    );

    expect(normalized).toEqual({
      nctId: "NCT05555555",
      title: "A Study of Memory in Adults",
      phaseLabel:
        "Phase 2: testing whether it works and is safe / Phase 3: comparing it with standard care in more people",
      conditions: ["Alzheimer Disease", "Memory"],
      status: "RECRUITING",
      cities: ["Boston", "Worcester", "Massachusetts"],
      source: "live",
    });
  });

  it("gives a live study outside Massachusetts no cities, so filterTrials drops it (Req 8.3)", () => {
    const normalized = normalizeTrial(liveStudy([{ city: "Albany", state: "New York" }]), "live");
    expect(normalized.cities).toEqual([]);
    expect(filterTrials([normalized])).toEqual([]);
  });

  it("normalizes a slice row as RECRUITING in Massachusetts (Req 6.3, 6.4)", () => {
    expect(
      normalizeTrial(
        {
          nct_id: "NCT06837181",
          title: "Studying CFRD",
          phase: "",
          conditions: "Cystic Fibrosis (CF), , Diabetes",
          massachusetts_city: "",
          status: "COMPLETED",
        },
        "saved_ma_slice",
      ),
    ).toEqual({
      nctId: "NCT06837181",
      title: "Studying CFRD",
      phaseLabel: "Phase not listed",
      conditions: ["Cystic Fibrosis (CF)", "Diabetes"],
      status: "RECRUITING",
      cities: ["Massachusetts"],
      source: "saved_ma_slice",
    });
  });

  it("turns missing and non-string fields into empty values (Req 7.2)", () => {
    for (const raw of [null, undefined, 42, "x", [], {}, { protocolSection: { identificationModule: { nctId: 7 } } }]) {
      const live = normalizeTrial(raw, "live");
      expect(live).toEqual({
        nctId: "",
        title: "",
        phaseLabel: "Phase not listed",
        conditions: [],
        status: "",
        cities: [],
        source: "live",
      });
      const slice = normalizeTrial(raw, "saved_ma_slice");
      expect(slice.nctId).toBe("");
      expect(slice.title).toBe("");
      expect(slice.conditions).toEqual([]);
    }
  });
});

describe("parseSliceCsv", () => {
  it("handles quoted fields, doubled quotes, commas and newlines in quotes", () => {
    const text =
      "nct_id,title,phase,conditions,massachusetts_city,status\r\n" +
      'NCT1,"A ""Big"" Study, Part 2",PHASE1,"Alzheimer Disease, Memory",,RECRUITING\r\n' +
      'NCT2,"Line one\nline two",NA,ALS,,RECRUITING\n' +
      "\n" +
      "NCT3,Short row\n";

    expect(parseSliceCsv(text)).toEqual([
      {
        nct_id: "NCT1",
        title: 'A "Big" Study, Part 2',
        phase: "PHASE1",
        conditions: "Alzheimer Disease, Memory",
        massachusetts_city: "",
        status: "RECRUITING",
      },
      {
        nct_id: "NCT2",
        title: "Line one\nline two",
        phase: "NA",
        conditions: "ALS",
        massachusetts_city: "",
        status: "RECRUITING",
      },
      {
        nct_id: "NCT3",
        title: "Short row",
        phase: "",
        conditions: "",
        massachusetts_city: "",
        status: "",
      },
    ]);
  });

  it("returns no rows for empty text", () => {
    expect(parseSliceCsv("")).toEqual([]);
    expect(parseSliceCsv("nct_id,title\n")).toEqual([]);
  });

  describe("on the real saved slice", () => {
    const rows = parseSliceCsv(readFileSync(SLICE_PATH, "utf8"));
    const trials = rows.map((row) => normalizeTrial(row, "saved_ma_slice"));

    it("parses 3,131 rows, all RECRUITING", () => {
      expect(rows).toHaveLength(3131);
      expect(rows.every((row) => row.status === "RECRUITING")).toBe(true);
      expect(rows.every((row) => row.massachusetts_city === "")).toBe(true);
    });

    it("matches 5, 47 and 21 rows for the three family conditions (Req 6.2)", () => {
      const count = (condition: string) =>
        trials.filter((t) => matchesCondition(t, condition)).length;
      expect(count("huntington")).toBe(5);
      expect(count("familial_alzheimers")).toBe(47);
      expect(count("als")).toBe(21);
    });

    it("gives every slice trial RECRUITING and [\"Massachusetts\"] after filtering (Req 6.3, 6.4)", () => {
      const filtered = filterTrials(trials);
      expect(filtered).toHaveLength(3131);
      for (const t of filtered) {
        expect(t.status).toBe("RECRUITING");
        expect(t.cities).toEqual(["Massachusetts"]);
      }
    });
  });
});

describe("URLs", () => {
  it("builds the study link and returns null for a blank id (Req 8.5, 8.6)", () => {
    expect(studyUrl("NCT05555555")).toBe("https://clinicaltrials.gov/study/NCT05555555");
    expect(studyUrl("")).toBeNull();
    expect(studyUrl("   ")).toBeNull();
  });

  it("builds the Massachusetts recruiting search per condition (Req 6.5)", () => {
    expect(conditionSearchUrl("familial_alzheimers")).toBe(
      "https://clinicaltrials.gov/search?cond=Alzheimer%20Disease&aggFilters=status:rec&country=United%20States&state=Massachusetts&locStr=Massachusetts",
    );
    expect(conditionSearchUrl("huntington")).toBe(
      "https://clinicaltrials.gov/search?cond=Huntington%20Disease&aggFilters=status:rec&country=United%20States&state=Massachusetts&locStr=Massachusetts",
    );
    expect(conditionSearchUrl("als")).toBe(
      "https://clinicaltrials.gov/search?cond=Amyotrophic%20Lateral%20Sclerosis&aggFilters=status:rec&country=United%20States&state=Massachusetts&locStr=Massachusetts",
    );
  });
});
