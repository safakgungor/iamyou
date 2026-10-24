// Feature: care-outputs, Task 6: the care-outputs zod schemas.
//
// Checks the request limits, the trials response union and the per-call
// family answer schema that limits citations to the ids that were sent.
//
// Validates: Requirements 1.2, 5.7, 6.5, 7.1, 9.5
import { describe, expect, it } from "vitest";

import {
  FamilyRequestSchema,
  FamilyResponseSchema,
  SummaryRequestSchema,
  TrialsResponseSchema,
} from "@/lib/api-schemas";
import { familyAnswerSchemaFor } from "@/lib/claude/schemas";

const TRIAL = {
  nctId: "NCT1",
  title: "A study",
  phaseLabel: "Not a drug trial",
  conditions: ["Alzheimer Disease"],
  status: "RECRUITING",
  cities: ["Boston"],
  source: "live",
};

describe("care-outputs schemas", () => {
  it("caps the summary's discuss at 500 and contact at 200 characters, both optional", () => {
    expect(SummaryRequestSchema.safeParse({}).success).toBe(true);
    expect(SummaryRequestSchema.safeParse({ discuss: "x".repeat(500), contact: "y".repeat(200) }).success).toBe(true);
    expect(SummaryRequestSchema.safeParse({ discuss: "x".repeat(501) }).success).toBe(false);
    expect(SummaryRequestSchema.safeParse({ contact: "y".repeat(201) }).success).toBe(false);
  });

  it("accepts the three trials states and rejects an ok list without trials", () => {
    expect(
      TrialsResponseSchema.safeParse({ status: "ok", origin: "live", trials: [TRIAL], search_url: "u" }).success,
    ).toBe(true);
    expect(
      TrialsResponseSchema.safeParse({ status: "ok", origin: "live", trials: [], search_url: "u" }).success,
    ).toBe(false);
    expect(
      TrialsResponseSchema.safeParse({ status: "no_matches", trials: [], message: "m", search_url: "u" }).success,
    ).toBe(true);
    expect(TrialsResponseSchema.safeParse({ status: "no_family_condition", trials: [] }).success).toBe(true);
    expect(
      TrialsResponseSchema.safeParse({ status: "ok", origin: "live", trials: [{ ...TRIAL, source: "x" }], search_url: "u" })
        .success,
    ).toBe(false);
  });

  it("limits the family request and never returns a style example", () => {
    expect(FamilyRequestSchema.safeParse({ asker: "Ella", question: "Hi?" }).success).toBe(true);
    expect(FamilyRequestSchema.safeParse({ asker: "", question: "Hi?" }).success).toBe(false);
    expect(FamilyRequestSchema.safeParse({ asker: "Ella", question: "   " }).success).toBe(false);
    expect(FamilyRequestSchema.safeParse({ asker: "Ella", question: "x".repeat(501) }).success).toBe(false);
    expect(
      FamilyResponseSchema.safeParse({
        asker: "Ella",
        answer: "a",
        cited_entries: [{ id: "v034", kind: "style_example", text: "t" }],
        synthetic_label: "Synthetic data",
      }).success,
    ).toBe(false);
  });

  it("builds a family answer schema whose citations are limited to the sent ids (Req 9.5)", () => {
    const schema = familyAnswerSchemaFor(["v001", "v002"]);
    expect(schema.safeParse({ answer: "a", cited_entry_ids: ["v002", "v001"] }).success).toBe(true);
    expect(schema.safeParse({ answer: "a", cited_entry_ids: ["v003"] }).success).toBe(false);
    expect(schema.safeParse({ answer: "a", cited_entry_ids: [] }).success).toBe(true);
  });
});
