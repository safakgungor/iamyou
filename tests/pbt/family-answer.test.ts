// Feature: care-outputs, Property 2: A family answer is cited or admits it does not know
// Validates: Requirements 10.1, 10.2, 10.3, 10.4
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { dontKnowAnswer, validateFamilyAnswer, type FamilyAnswer } from "@/lib/family";

const idArb = fc.oneof(fc.constantFrom("v001", "v002", "v003", "v004", "x"), fc.string({ maxLength: 6 }));
const firstNameArb = fc.oneof(fc.constant("Maya"), fc.constant(null), fc.string({ maxLength: 8 }));

/** True when `sub` is a subsequence of `seq` (same order, not necessarily contiguous). */
function isSubsequence(sub: readonly string[], seq: readonly string[]): boolean {
  let i = 0;
  for (const item of seq) if (i < sub.length && sub[i] === item) i += 1;
  return i === sub.length;
}

/** The P2 disjunction for one result. */
function expectCitedOrDontKnow(
  result: FamilyAnswer,
  input: FamilyAnswer,
  entryIds: ReadonlySet<string>,
  firstName: string | null,
): void {
  if (result.cited_entry_ids.length === 0) {
    expect(result).toEqual({ answer: dontKnowAnswer(firstName), cited_entry_ids: [] });
    return;
  }
  expect(result.answer).toBe(input.answer);
  expect(new Set(result.cited_entry_ids).size).toBe(result.cited_entry_ids.length);
  for (const id of result.cited_entry_ids) expect(entryIds.has(id)).toBe(true);
  expect(isSubsequence(result.cited_entry_ids, input.cited_entry_ids)).toBe(true);
}

describe("validateFamilyAnswer (Property 2)", () => {
  it("returns the input answer with existing cited ids, or exactly the Dont_Know_Answer", () => {
    fc.assert(
      fc.property(
        fc.record({ answer: fc.string(), cited_entry_ids: fc.array(idArb, { maxLength: 8 }) }),
        fc.array(fc.record({ id: idArb }), { maxLength: 6 }),
        firstNameArb,
        (input, entries, firstName) => {
          const entryIds = new Set(entries.map((e) => e.id));
          const result = validateFamilyAnswer(input, entries, firstName);

          expectCitedOrDontKnow(result, input, entryIds, firstName);

          // Every input id that exists survives exactly once (nothing dropped
          // beyond unknown ids and duplicates).
          const expectedIds = [...new Set(input.cited_entry_ids.filter((id) => entryIds.has(id)))];
          expect(result.cited_entry_ids).toEqual(expectedIds);

          // Idempotent: applying it twice equals applying it once.
          expect(validateFamilyAnswer(result, entries, firstName)).toEqual(result);
        },
      ),
      { numRuns: 300 },
    );
  });
});
