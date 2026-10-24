/**
 * Pure check-in result shaping for the twin-loop. No I/O.
 *
 * `buildCheckInResult` turns a grading result plus the twin's prediction and
 * spoken reply into the shape shown to the user, applying the crisis and
 * genetics safety rules. It is the target of property test P5. `sessionScore`
 * averages this session's already-clamped scores.
 */

import { SUPPORT_MESSAGE, COUNSELOR_MESSAGE } from './safety';

/**
 * A grading result from Claude. `score` is already clamped into [0, 1] by the
 * route via `clampScore`. (Req 6.1)
 */
export type Grade = {
  score: number;
  rationale: string;
  crisis: boolean;
  genetics_question: boolean;
};

/**
 * The result the Check_In_Service reveals to the user: either a supportive
 * message (crisis) or a scored result with the prediction and a spoken reply.
 */
export type CheckInResult =
  | { kind: 'support'; message: string }
  | { kind: 'scored'; score: number; prediction: string; reply: string };

/**
 * Shapes the user-facing check-in result from the grade, prediction, and reply.
 *
 * Crisis is checked FIRST: when `crisis` is true the result is the support
 * message with no score, prediction, or reply, regardless of
 * `genetics_question` (Req 9.1 / P5). Otherwise, when `genetics_question` is
 * true, the scored result keeps the score and prediction but replaces the reply
 * with the counselor message (Req 9.3). Otherwise the normal scored result is
 * returned with the real reply (Req 6.5).
 */
export function buildCheckInResult(input: {
  grade: Grade;
  prediction: string;
  reply: string;
}): CheckInResult {
  const { grade, prediction, reply } = input;

  if (grade.crisis) {
    return { kind: 'support', message: SUPPORT_MESSAGE };
  }

  if (grade.genetics_question) {
    return {
      kind: 'scored',
      score: grade.score,
      prediction,
      reply: COUNSELOR_MESSAGE,
    };
  }

  return { kind: 'scored', score: grade.score, prediction, reply };
}

/**
 * Mean of this session's already-clamped scores; 0 when there are none.
 * (Req 8.1)
 */
export function sessionScore(scores: number[]): number {
  if (scores.length === 0) {
    return 0;
  }
  const total = scores.reduce((sum, score) => sum + score, 0);
  return total / scores.length;
}
