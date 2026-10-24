// Feature: care-outputs, Task 3.4: unit tests for lib/family.ts.
//
// Covers the exact Dont_Know_Answer, who may ask (Maya's digital will and
// malformed shapes), exact-match asker checks, and entry selection order.
//
// Validates: Requirements 9.1, 9.2, 10.2
import { describe, expect, it } from "vitest";

import mayaProfile from "@/data/synthetic/maya/profile.json";
import mayaVaultEntries from "@/data/synthetic/maya/vault-entries.json";
import type { VaultEntry } from "@/lib/db/vault-repository";
import {
  FAMILY_ENTRY_LIMIT,
  dontKnowAnswer,
  familyModeAccess,
  isAllowedAsker,
  selectFamilyEntries,
  validateFamilyAnswer,
} from "@/lib/family";

function entry(id: string, kind: VaultEntry["kind"], createdAt: string): VaultEntry {
  return { id, kind, text: `text of ${id}`, createdAt };
}

describe("dontKnowAnswer", () => {
  it("names the person exactly (Req 10.2)", () => {
    expect(dontKnowAnswer("Maya")).toBe("I don't know how Maya would answer that.");
  });

  it("falls back to 'this person' without a first name", () => {
    expect(dontKnowAnswer(null)).toBe("I don't know how this person would answer that.");
    expect(dontKnowAnswer("  ")).toBe("I don't know how this person would answer that.");
  });
});

describe("familyModeAccess", () => {
  it("returns Maya's daughter from her digital will (Req 9.1)", () => {
    expect(familyModeAccess(mayaProfile.digital_will)).toEqual(["Ella Linden (daughter)"]);
  });

  it("returns [] for every other shape", () => {
    for (const will of [
      null,
      undefined,
      "Ella Linden (daughter)",
      42,
      [],
      {},
      { family_mode_access: "Ella Linden (daughter)" },
      { family_mode_access: { 0: "Ella" } },
      { family_mode_access: [1, null, {}, "", "   "] },
    ]) {
      expect(familyModeAccess(will)).toEqual([]);
    }
  });

  it("trims names, drops non-strings and duplicates, and keeps order", () => {
    expect(
      familyModeAccess({ family_mode_access: [" Ella ", 3, "Sam", "Ella", null] }),
    ).toEqual(["Ella", "Sam"]);
  });
});

describe("isAllowedAsker", () => {
  const will = mayaProfile.digital_will;

  it("accepts only an exact listed name (Req 9.1)", () => {
    expect(isAllowedAsker(will, "Ella Linden (daughter)")).toBe(true);
  });

  it("rejects near-misses and anyone when nobody is listed", () => {
    for (const asker of [
      "ella linden (daughter)",
      "Ella  Linden (daughter)",
      "Ella Linden(daughter)",
      "Ella Linden",
      "",
      " Ella Linden (daughter)",
    ]) {
      expect(isAllowedAsker(will, asker)).toBe(false);
    }
    expect(isAllowedAsker(null, "Ella Linden (daughter)")).toBe(false);
    expect(isAllowedAsker({}, "Ella Linden (daughter)")).toBe(false);
  });
});

describe("selectFamilyEntries", () => {
  it("drops style examples and orders newest first, id as tie-break (Req 9.2)", () => {
    const entries = [
      entry("b", "story", "2030-01-01"),
      entry("s", "style_example", "2040-01-01"),
      entry("a", "opinion", "2030-01-01"),
      entry("c", "correction", "2035-06-01"),
      entry("d", "conversation", "2020-01-01"),
    ];

    expect(selectFamilyEntries(entries).map((e) => e.id)).toEqual(["c", "a", "b", "d"]);
  });

  it("keeps at most 40 entries", () => {
    const entries = Array.from({ length: 55 }, (_, i) =>
      entry(`e${String(i).padStart(2, "0")}`, "story", `2030-01-${String((i % 28) + 1).padStart(2, "0")}`),
    );
    expect(selectFamilyEntries(entries)).toHaveLength(FAMILY_ENTRY_LIMIT);
  });

  it("sends Maya's 33 non-style entries and none of her 7 style examples", () => {
    const entries: VaultEntry[] = mayaVaultEntries.map((e) => ({
      id: e.id,
      kind: e.kind as VaultEntry["kind"],
      text: e.text,
      createdAt: e.created_at,
    }));
    const selected = selectFamilyEntries(entries);
    expect(selected).toHaveLength(33);
    expect(selected.some((e) => e.kind === "style_example")).toBe(false);
  });
});

describe("validateFamilyAnswer", () => {
  const entries = [{ id: "v001" }, { id: "v002" }];

  it("keeps existing cited ids in order, deduplicated, with the answer unchanged (Req 10.3, 10.4)", () => {
    expect(
      validateFamilyAnswer(
        { answer: "I'd check it three times.", cited_entry_ids: ["v002", "nope", "v001", "v002"] },
        entries,
        "Maya",
      ),
    ).toEqual({ answer: "I'd check it three times.", cited_entry_ids: ["v002", "v001"] });
  });

  it("returns the Dont_Know_Answer when no citation survives (Req 10.2)", () => {
    expect(
      validateFamilyAnswer({ answer: "Made up.", cited_entry_ids: ["v999"] }, entries, "Maya"),
    ).toEqual({ answer: "I don't know how Maya would answer that.", cited_entry_ids: [] });
    expect(
      validateFamilyAnswer(
        { answer: "Made up.", cited_entry_ids: "v001" as unknown as string[] },
        entries,
        "Maya",
      ),
    ).toEqual({ answer: "I don't know how Maya would answer that.", cited_entry_ids: [] });
  });
});
