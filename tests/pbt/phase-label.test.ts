// Feature: care-outputs, Property 5: Phase labels are total and deterministic
// Validates: Requirements 7.3, 7.4, 7.5, 7.6
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { PHASE_LABELS, PHASE_NOT_LISTED, phaseLabel } from "@/lib/trials";

const TOKENS = [...PHASE_LABELS.keys()];

/** A recognized token in random case with random surrounding spaces. */
const tokenArb = fc
  .tuple(
    fc.constantFrom(...TOKENS),
    fc.array(fc.boolean(), { minLength: 12, maxLength: 12 }),
    fc.constantFrom("", " ", "  "),
    fc.constantFrom("", " ", "\t"),
  )
  .map(([token, upper, before, after]) => ({
    token,
    text:
      before +
      [...token].map((ch, i) => (upper[i % upper.length] ? ch : ch.toLowerCase())).join("") +
      after,
  }));

/** The expected label of a token list: dedupe in order, join, or the fallback. */
function expectedLabel(tokens: string[]): string {
  const unique = [...new Set(tokens)];
  return unique.length > 0
    ? unique.map((t) => PHASE_LABELS.get(t)).join(" / ")
    : PHASE_NOT_LISTED;
}

describe("phaseLabel (Property 5)", () => {
  it("returns a non-empty string, the same on every call, for any input", () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.string(), fc.array(fc.string()), fc.anything()),
        (raw) => {
          const label = phaseLabel(raw);
          expect(typeof label).toBe("string");
          expect(label.length).toBeGreaterThan(0);
          expect(phaseLabel(raw)).toBe(label);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("maps a single recognized token to its table label", () => {
    fc.assert(
      fc.property(tokenArb, ({ token, text }) => {
        expect(phaseLabel(text)).toBe(PHASE_LABELS.get(token));
        expect(phaseLabel([text])).toBe(PHASE_LABELS.get(token));
      }),
      { numRuns: 200 },
    );
  });

  it("joins the recognized labels of a combined value with ' / ' in input order", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            { weight: 3, arbitrary: tokenArb },
            {
              weight: 1,
              arbitrary: fc
                .string()
                .filter((s) => !s.includes(",") && !PHASE_LABELS.has(s.trim().toUpperCase()))
                .map((text) => ({ token: null as string | null, text })),
            },
          ),
          { maxLength: 6 },
        ),
        (parts) => {
          const recognized = parts.flatMap((p) => (p.token === null ? [] : [p.token]));
          const expected = expectedLabel(recognized);
          // The CSV form and the API array form give the same label.
          expect(phaseLabel(parts.map((p) => p.text).join(","))).toBe(expected);
          expect(phaseLabel(parts.map((p) => p.text))).toBe(expected);
        },
      ),
      { numRuns: 200 },
    );
  });
});
