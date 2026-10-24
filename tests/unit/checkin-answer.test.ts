// Feature: twin-loop, Task 13.2: unit tests for POST /api/checkin/answer.
//
// These tests exercise `submitAnswer` — the testable core of the answer route —
// with an `InMemoryVaultRepository` and a MOCKED Claude client (`AnswerClaude`).
// No HTTP, no auth, no network. A prediction row is seeded first so the helper
// can load it; `gradeAnswer` / `spokenReply` are stubbed per case.
//
// Covered behaviours (design "POST /api/checkin/answer", Req 6, 9):
//   - Non-crisis, non-genetics ⇒ scored result; clamped score stored on one
//     answer row; result carries the prediction + the mocked reply.
//   - Genetics (crisis=false, genetics_question=true) ⇒ scored result whose
//     reply is COUNSELOR_MESSAGE; score + prediction retained.
//   - Crisis (crisis=true) ⇒ support result { kind:'support', message:
//     SUPPORT_MESSAGE }; NO answer stored.
//   - Grading refusal fail-safe (gradeAnswer returns crisis:true) ⇒ support
//     result; no answer and no score stored. Same observable behaviour as crisis.
//   - Clamping: raw 1.5 ⇒ stored 1; raw -0.2 ⇒ stored 0.
//   - 404 when the prediction_id is unknown.
//
// Validates: Requirements 6.4, 6.5, 9.1, 9.3
import { describe, expect, it } from "vitest";

import {
  submitAnswer,
  type AnswerClaude,
  type SubmitAnswerBody,
} from "@/app/api/checkin/answer/route";
import { InMemoryVaultRepository } from "@/lib/db/vault-repository";
import { SUPPORT_MESSAGE, COUNSELOR_MESSAGE } from "@/lib/safety";
import type { Grading } from "@/lib/claude/schemas";

/* -------------------------------------------------------------------------- */
/* Fixtures & helpers                                                         */
/* -------------------------------------------------------------------------- */

const USER_ID = "user-1";
const PROMPT_ID = "prompt-1";
const PREDICTED_TEXT = "I feel steady and focused about work.";
const ANSWER_TEXT = "Work has been good, I feel focused.";
const REPLY_TEXT = "It sounds like work is sitting well with you today.";

/**
 * Seeds a prediction row for USER_ID and returns the repo plus a ready-made
 * request body pointing at that prediction.
 */
async function seedPrediction(repo: InMemoryVaultRepository): Promise<{
  body: SubmitAnswerBody;
  predictionId: string;
}> {
  const prediction = await repo.createPrediction(USER_ID, {
    promptId: PROMPT_ID,
    predictedText: PREDICTED_TEXT,
  });
  return {
    predictionId: prediction.id,
    body: {
      prediction_id: prediction.id,
      session_id: "session-1",
      answer: ANSWER_TEXT,
    },
  };
}

/**
 * Builds a mocked `AnswerClaude`. `gradeAnswer` returns `grading`; `spokenReply`
 * returns REPLY_TEXT and records whether it was called (crisis must skip it).
 */
function makeClaude(grading: Grading): {
  claude: AnswerClaude;
  state: { spokenReplyCalls: number };
} {
  const state = { spokenReplyCalls: 0 };
  const claude: AnswerClaude = {
    gradeAnswer: async () => grading,
    spokenReply: async () => {
      state.spokenReplyCalls += 1;
      return REPLY_TEXT;
    },
  };
  return { claude, state };
}

/* -------------------------------------------------------------------------- */
/* Non-crisis, non-genetics                                                   */
/* -------------------------------------------------------------------------- */

describe("submitAnswer — non-crisis, non-genetics", () => {
  it("returns a scored result and stores one answer row with the clamped score", async () => {
    const repo = new InMemoryVaultRepository();
    const { body } = await seedPrediction(repo);
    const { claude } = makeClaude({
      score: 0.82,
      rationale: "The prediction captured the same stance.",
      crisis: false,
      genetics_question: false,
    });

    const outcome = await submitAnswer(repo, claude, USER_ID, body);

    expect(outcome.status).toBe(200);
    expect(outcome.body).toEqual({
      kind: "scored",
      score: 0.82,
      prediction: PREDICTED_TEXT,
      reply: REPLY_TEXT,
    });

    const answers = await repo.listAnswers(USER_ID);
    expect(answers).toHaveLength(1);
    expect(answers[0].score).toBe(0.82);
    expect(answers[0].answerText).toBe(ANSWER_TEXT);
    expect(answers[0].crisis).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Genetics (crisis=false, genetics_question=true)                            */
/* -------------------------------------------------------------------------- */

describe("submitAnswer — genetics question", () => {
  it("returns a scored result whose reply is the counselor message, keeping score + prediction", async () => {
    const repo = new InMemoryVaultRepository();
    const { body } = await seedPrediction(repo);
    const { claude } = makeClaude({
      score: 0.6,
      rationale: "Asked about a genetic test result.",
      crisis: false,
      genetics_question: true,
    });

    const outcome = await submitAnswer(repo, claude, USER_ID, body);

    expect(outcome.status).toBe(200);
    expect(outcome.body).toEqual({
      kind: "scored",
      score: 0.6,
      prediction: PREDICTED_TEXT,
      reply: COUNSELOR_MESSAGE,
    });

    // The score is still stored for a genetics (non-crisis) answer.
    const answers = await repo.listAnswers(USER_ID);
    expect(answers).toHaveLength(1);
    expect(answers[0].score).toBe(0.6);
  });
});

/* -------------------------------------------------------------------------- */
/* Crisis (crisis=true)                                                       */
/* -------------------------------------------------------------------------- */

describe("submitAnswer — crisis", () => {
  it("returns the support result and stores no answer, without calling spokenReply", async () => {
    const repo = new InMemoryVaultRepository();
    const { body } = await seedPrediction(repo);
    const { claude, state } = makeClaude({
      score: 0.9,
      rationale: "ignored on crisis",
      crisis: true,
      genetics_question: false,
    });

    const outcome = await submitAnswer(repo, claude, USER_ID, body);

    expect(outcome.status).toBe(200);
    expect(outcome.body).toEqual({ kind: "support", message: SUPPORT_MESSAGE });

    const answers = await repo.listAnswers(USER_ID);
    expect(answers).toHaveLength(0);
    expect(state.spokenReplyCalls).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Grading refusal fail-safe (gradeAnswer returns crisis: true)               */
/* -------------------------------------------------------------------------- */

describe("submitAnswer — grading refusal fail-safe", () => {
  it("treats the crisis fail-safe like a crisis: support result, no answer, no score", async () => {
    const repo = new InMemoryVaultRepository();
    const { body } = await seedPrediction(repo);
    // The grading fail-safe from the Claude layer surfaces as crisis:true, score 0.
    const { claude } = makeClaude({
      score: 0,
      rationale: "",
      crisis: true,
      genetics_question: false,
    });

    const outcome = await submitAnswer(repo, claude, USER_ID, body);

    expect(outcome.status).toBe(200);
    expect(outcome.body).toEqual({ kind: "support", message: SUPPORT_MESSAGE });

    const answers = await repo.listAnswers(USER_ID);
    expect(answers).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Clamping                                                                   */
/* -------------------------------------------------------------------------- */

describe("submitAnswer — score clamping", () => {
  it("clamps a raw score above 1 down to 1 when storing and reporting", async () => {
    const repo = new InMemoryVaultRepository();
    const { body } = await seedPrediction(repo);
    const { claude } = makeClaude({
      score: 1.5,
      rationale: "overshoot",
      crisis: false,
      genetics_question: false,
    });

    const outcome = await submitAnswer(repo, claude, USER_ID, body);

    expect(outcome.status).toBe(200);
    expect(outcome.body).toEqual({
      kind: "scored",
      score: 1,
      prediction: PREDICTED_TEXT,
      reply: REPLY_TEXT,
    });

    const answers = await repo.listAnswers(USER_ID);
    expect(answers).toHaveLength(1);
    expect(answers[0].score).toBe(1);
  });

  it("clamps a negative raw score up to 0 when storing and reporting", async () => {
    const repo = new InMemoryVaultRepository();
    const { body } = await seedPrediction(repo);
    const { claude } = makeClaude({
      score: -0.2,
      rationale: "undershoot",
      crisis: false,
      genetics_question: false,
    });

    const outcome = await submitAnswer(repo, claude, USER_ID, body);

    expect(outcome.status).toBe(200);
    expect(outcome.body).toEqual({
      kind: "scored",
      score: 0,
      prediction: PREDICTED_TEXT,
      reply: REPLY_TEXT,
    });

    const answers = await repo.listAnswers(USER_ID);
    expect(answers).toHaveLength(1);
    expect(answers[0].score).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Unknown prediction ⇒ 404                                                   */
/* -------------------------------------------------------------------------- */

describe("submitAnswer — unknown prediction", () => {
  it("returns 404 when the prediction_id is not found for the caller", async () => {
    const repo = new InMemoryVaultRepository();
    // No prediction seeded for this id.
    const { claude } = makeClaude({
      score: 0.5,
      rationale: "unused",
      crisis: false,
      genetics_question: false,
    });

    const outcome = await submitAnswer(repo, claude, USER_ID, {
      prediction_id: "does-not-exist",
      session_id: "session-1",
      answer: ANSWER_TEXT,
    });

    expect(outcome.status).toBe(404);
    expect(outcome.body).toEqual({ error: "Prediction not found" });

    const answers = await repo.listAnswers(USER_ID);
    expect(answers).toHaveLength(0);
  });
});
