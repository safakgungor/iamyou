// Feature: care-outputs, Property 4: Family entry selection never sends style examples
// Validates: Requirements 9.2
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import type { VaultEntry } from "@/lib/db/vault-repository";
import { FAMILY_ENTRY_LIMIT, selectFamilyEntries } from "@/lib/family";

const KINDS: VaultEntry["kind"][] = [
  "conversation",
  "correction",
  "story",
  "opinion",
  "style_example",
];

const entriesArb = fc
  .array(
    fc.record({
      kind: fc.constantFrom(...KINDS),
      text: fc.string(),
      createdAt: fc
        .date({
          min: new Date(Date.UTC(2020, 0, 1)),
          max: new Date(Date.UTC(2050, 11, 31)),
          noInvalidDate: true,
        })
        .map((d) => d.toISOString().slice(0, 10)),
    }),
    { maxLength: 90 },
  )
  .map((rows) => rows.map((row, index): VaultEntry => ({ id: `e${index}`, ...row })));

describe("selectFamilyEntries (Property 4)", () => {
  it("returns at most 40 input entries, none a style example, all of them when 40 or fewer are allowed", () => {
    fc.assert(
      fc.property(entriesArb, (entries) => {
        const frozen = Object.freeze(entries.map((e) => Object.freeze({ ...e })));
        const selected = selectFamilyEntries(frozen);
        const allowed = entries.filter((e) => e.kind !== "style_example");

        expect(selected.length).toBeLessThanOrEqual(FAMILY_ENTRY_LIMIT);
        for (const e of selected) {
          expect(e.kind).not.toBe("style_example");
          expect(entries).toContainEqual(e);
        }
        if (allowed.length <= FAMILY_ENTRY_LIMIT) {
          expect(selected.map((e) => e.id).sort()).toEqual(allowed.map((e) => e.id).sort());
        } else {
          expect(selected).toHaveLength(FAMILY_ENTRY_LIMIT);
        }
      }),
      { numRuns: 200 },
    );
  });
});
