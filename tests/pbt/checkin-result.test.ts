// Feature: twin-loop, Property 5: Crisis and genetics result shaping
// Validates: Requirements 6.5, 9.1, 9.3
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { buildCheckInResult } from "@/lib/check-in";
import { SUPPORT_MESSAGE, COUNSELOR_MESSAGE } from "@/lib/safety";

// Arbitrary grade: vary crisis + genetics_question booleans, score number, rationale string.
const gradeArb = fc.record({
  score: fc.double({ noNaN: true, min: 0, max: 1 }),
  rationale: fc.string(),
  crisis: fc.boolean(),
  genetics_question: fc.boolean(),
});

describe("buildCheckInResult (Property 5: Crisis and genetics result shaping)", () => {
  it("shapes the result by crisis then genetics across all inputs", () => {
    fc.assert(
      fc.property(
        gradeArb,
        fc.string(), // prediction
        fc.string(), // reply
        (grade, prediction, reply) => {
          const result = buildCheckInResult({ grade, prediction, reply });

          if (grade.crisis) {
            // crisis=true ⇒ support result, regardless of genetics_question.
            expect(result.kind).toBe("support");
            if (result.kind === "support") {
              expect(result.message).toBe(SUPPORT_MESSAGE);
            }
            // No score/prediction/reply keys carried on the crisis branch.
            expect("score" in result).toBe(false);
            expect("prediction" in result).toBe(false);
            expect("reply" in result).toBe(false);
          } else if (grade.genetics_question) {
            // crisis=false & genetics=true ⇒ scored, keep score + prediction,
            // reply replaced by COUNSELOR_MESSAGE.
            expect(result.kind).toBe("scored");
            if (result.kind === "scored") {
              expect(result.score).toBe(grade.score);
              expect(result.prediction).toBe(prediction);
              expect(result.reply).toBe(COUNSELOR_MESSAGE);
            }
          } else {
            // crisis=false & genetics=false ⇒ scored with the real reply.
            expect(result.kind).toBe("scored");
            if (result.kind === "scored") {
              expect(result.score).toBe(grade.score);
              expect(result.prediction).toBe(prediction);
              expect(result.reply).toBe(reply);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("crisis wins over genetics_question regardless of its value", () => {
    fc.assert(
      fc.property(
        fc.double({ noNaN: true, min: 0, max: 1 }),
        fc.string(),
        fc.boolean(),
        fc.string(),
        fc.string(),
        (score, rationale, genetics_question, prediction, reply) => {
          const result = buildCheckInResult({
            grade: { score, rationale, crisis: true, genetics_question },
            prediction,
            reply,
          });
          expect(result).toEqual({ kind: "support", message: SUPPORT_MESSAGE });
        }
      ),
      { numRuns: 100 }
    );
  });
});
