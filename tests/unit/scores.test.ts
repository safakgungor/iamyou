// Feature: twin-loop, Task 15.2: unit tests for GET /api/scores.
//
// These tests exercise `getScores` — the testable core of the scores route —
// against an `InMemoryVaultRepository`. No HTTP, no auth, no network. Answers
// are seeded directly on the repo across two sessions with known clamped scores
// and `createdAt` timestamps spanning distinct ISO weeks. Each answer requires a
// `predictionId` (see `VaultRepository.createAnswer` / `NewAnswer`), so a
// prediction row is created per answer.
//
// Covered behaviours (design "GET /api/scores", Req 8.1, 8.2, 8.3):
//   - `session_score` is the mean of the queried session's clamped scores
//     (`sessionScore`), ignoring answers from other sessions.
//   - `weekly_trend` is the mean clamped score per ISO week over ALL of the
//     caller's answers (`weeklyTrend`), not just the queried session.
//   - Edge: a session with no answers ⇒ `session_score` 0, while the weekly
//     trend still reflects every answer the caller owns.
//
// Validates: Requirements 8.1
import { describe, expect, it } from "vitest";

import { getScores } from "@/app/api/scores/route";
import {
  InMemoryVaultRepository,
  type NewAnswer,
} from "@/lib/db/vault-repository";

/* -------------------------------------------------------------------------- */
/* Fixtures & helpers                                                         */
/* -------------------------------------------------------------------------- */

const USER_ID = "user-1";
const OTHER_USER_ID = "user-2";

const SESSION_1 = "session-1";
const SESSION_2 = "session-2";
const EMPTY_SESSION = "session-empty";

// Chosen so the ISO-week grouping is unambiguous (verified against lib/score):
//   2026-01-05T12:00:00Z -> 2026-W02 (Monday)
//   2026-01-13T12:00:00Z -> 2026-W03 (Tuesday)
const WEEK_02 = "2026-01-05T12:00:00Z";
const WEEK_03 = "2026-01-13T12:00:00Z";

/**
 * Seeds one graded answer for `userId`, creating a prediction first because
 * `createAnswer` requires a `predictionId`. The score is passed through as the
 * already-clamped value the answer route would have stored.
 */
async function seedAnswer(
  repo: InMemoryVaultRepository,
  userId: string,
  fields: {
    sessionId: string;
    score: number;
    createdAt: string;
  },
): Promise<void> {
  const prediction = await repo.createPrediction(userId, {
    promptId: "prompt-1",
    predictedText: "a stored prediction",
  });
  const answer: NewAnswer = {
    predictionId: prediction.id,
    sessionId: fields.sessionId,
    answerText: "an answer",
    score: fields.score,
    crisis: false,
    createdAt: fields.createdAt,
  };
  await repo.createAnswer(userId, answer);
}

/**
 * Seeds the shared fixture used by the trend/session tests:
 *   - SESSION_1: score 0.4 in ISO week W02, score 0.8 in W03.
 *   - SESSION_2: score 0.2 in W03.
 * A noise answer for OTHER_USER_ID guards against cross-user leakage.
 *
 * Expected derived values:
 *   - session_score(SESSION_1) = mean(0.4, 0.8) = 0.6
 *   - weekly_trend over ALL of USER_ID's answers:
 *       W02 = 0.4, W03 = mean(0.8, 0.2) = 0.5
 */
async function seedFixture(repo: InMemoryVaultRepository): Promise<void> {
  await seedAnswer(repo, USER_ID, {
    sessionId: SESSION_1,
    score: 0.4,
    createdAt: WEEK_02,
  });
  await seedAnswer(repo, USER_ID, {
    sessionId: SESSION_1,
    score: 0.8,
    createdAt: WEEK_03,
  });
  await seedAnswer(repo, USER_ID, {
    sessionId: SESSION_2,
    score: 0.2,
    createdAt: WEEK_03,
  });
  // Another user's answer must never influence USER_ID's scores.
  await seedAnswer(repo, OTHER_USER_ID, {
    sessionId: SESSION_1,
    score: 1,
    createdAt: WEEK_02,
  });
}

/* -------------------------------------------------------------------------- */
/* session_score                                                              */
/* -------------------------------------------------------------------------- */

describe("getScores — session_score", () => {
  it("returns the mean of the queried session's clamped scores", async () => {
    const repo = new InMemoryVaultRepository();
    await seedFixture(repo);

    const scores = await getScores(repo, USER_ID, SESSION_1);

    // mean(0.4, 0.8) = 0.6 — SESSION_2's 0.2 is excluded.
    expect(scores.session_score).toBeCloseTo(0.6, 10);
  });

  it("scopes the session score to the requested session only", async () => {
    const repo = new InMemoryVaultRepository();
    await seedFixture(repo);

    const scores = await getScores(repo, USER_ID, SESSION_2);

    // SESSION_2 holds a single 0.2 answer.
    expect(scores.session_score).toBeCloseTo(0.2, 10);
  });
});

/* -------------------------------------------------------------------------- */
/* weekly_trend                                                               */
/* -------------------------------------------------------------------------- */

describe("getScores — weekly_trend", () => {
  it("averages clamped scores per ISO week across ALL of the caller's answers", async () => {
    const repo = new InMemoryVaultRepository();
    await seedFixture(repo);

    const scores = await getScores(repo, USER_ID, SESSION_1);

    // W02: only the 0.4 answer. W03: mean(0.8 from S1, 0.2 from S2) = 0.5.
    expect(Object.keys(scores.weekly_trend).sort()).toEqual([
      "2026-W02",
      "2026-W03",
    ]);
    expect(scores.weekly_trend["2026-W02"]).toBeCloseTo(0.4, 10);
    expect(scores.weekly_trend["2026-W03"]).toBeCloseTo(0.5, 10);
  });

  it("does not include another user's answers in the trend", async () => {
    const repo = new InMemoryVaultRepository();
    await seedFixture(repo);

    const scores = await getScores(repo, USER_ID, SESSION_1);

    // OTHER_USER_ID's W02 score is 1; if it leaked, W02 would be 0.7, not 0.4.
    expect(scores.weekly_trend["2026-W02"]).toBeCloseTo(0.4, 10);
  });
});

/* -------------------------------------------------------------------------- */
/* Edge: empty session                                                        */
/* -------------------------------------------------------------------------- */

describe("getScores — empty session", () => {
  it("returns session_score 0 for a session with no answers", async () => {
    const repo = new InMemoryVaultRepository();
    await seedFixture(repo);

    const scores = await getScores(repo, USER_ID, EMPTY_SESSION);

    expect(scores.session_score).toBe(0);
    // The weekly trend still reflects every answer the caller owns.
    expect(scores.weekly_trend["2026-W02"]).toBeCloseTo(0.4, 10);
    expect(scores.weekly_trend["2026-W03"]).toBeCloseTo(0.5, 10);
  });

  it("returns session_score 0 and an empty trend when the caller has no answers at all", async () => {
    const repo = new InMemoryVaultRepository();
    // No answers seeded for anyone.

    const scores = await getScores(repo, USER_ID, SESSION_1);

    expect(scores.session_score).toBe(0);
    expect(scores.weekly_trend).toEqual({});
  });
});
