// Feature: twin-loop, Task 12.3: unit tests for GET /api/checkin/next.
//
// These tests exercise `nextCheckIn` — the HTTP-free core of the blind-
// prediction route — against an InMemoryVaultRepository and a mocked Claude
// whose `predictAnswer` returns a fixed predicted text. They prove that:
//   - the twin's prediction is stored in a `predictions` row before any answer
//     exists (Req 4.2);
//   - no answer row is created by the next call;
//   - the response body carries no `predicted_text`, so the prediction never
//     reaches the client before the user answers (Req 4.5);
//   - the lowest-numbered prompt unanswered in the session is chosen.
//
// Validates: Requirements 4.2, 4.5
import { describe, expect, it } from "vitest";

import {
  nextCheckIn,
  type CheckInClaude,
  type CheckInPrompt,
} from "@/app/api/checkin/next/route";
import { InMemoryVaultRepository } from "@/lib/db/vault-repository";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const USER_ID = "user-1";
const SESSION_ID = "session-1";

/** A fixed predicted text the mocked Claude always returns. */
const PREDICTED_TEXT = "I think I would sleep in and then go for a long walk.";

/** A three-prompt list in id order, mirroring the real c01..c20 shape. */
const PROMPTS: CheckInPrompt[] = [
  { id: "c01", category: "preference", text: "What would you do with a free Saturday?" },
  { id: "c02", category: "social", text: "Who would you call first with good news?" },
  { id: "c03", category: "preference", text: "Coffee or tea this morning?" },
];

/**
 * A mocked Claude whose `predictAnswer` ignores its request and returns a
 * fixed text, recording how many times it was called. No real client is built.
 */
function makeClaude(predictedText = PREDICTED_TEXT): {
  claude: CheckInClaude;
  calls: number;
} {
  const state = { calls: 0 };
  const claude: CheckInClaude = {
    predictAnswer: (async () => {
      state.calls += 1;
      return predictedText;
    }) as CheckInClaude["predictAnswer"],
  };
  return {
    claude,
    get calls() {
      return state.calls;
    },
  };
}

/**
 * Seeds the session with an answered prompt: a stored prediction for `promptId`
 * plus an answer row referencing it in `SESSION_ID`. Returns the prediction id.
 */
async function seedAnswered(
  repo: InMemoryVaultRepository,
  promptId: string,
): Promise<string> {
  const prediction = await repo.createPrediction(USER_ID, {
    promptId,
    predictedText: "a previously stored prediction",
  });
  await repo.createAnswer(USER_ID, {
    predictionId: prediction.id,
    sessionId: SESSION_ID,
    answerText: "an earlier answer",
    score: 0.5,
    crisis: false,
  });
  return prediction.id;
}

/* -------------------------------------------------------------------------- */
/* Tests                                                                      */
/* -------------------------------------------------------------------------- */

describe("nextCheckIn", () => {
  it("stores a prediction row with the predicted text (Req 4.2)", async () => {
    const repo = new InMemoryVaultRepository();
    const { claude } = makeClaude();

    const result = await nextCheckIn(
      repo,
      claude,
      PROMPTS,
      USER_ID,
      SESSION_ID,
    );

    expect(result).not.toBeNull();
    // The returned prediction_id resolves to a stored row holding the text.
    const stored = await repo.getPrediction(USER_ID, result!.prediction_id);
    expect(stored).not.toBeNull();
    expect(stored!.predictedText).toBe(PREDICTED_TEXT);
    expect(stored!.promptId).toBe("c01");
  });

  it("creates no answer row for the just-predicted prompt", async () => {
    const repo = new InMemoryVaultRepository();
    const { claude } = makeClaude();

    await nextCheckIn(repo, claude, PROMPTS, USER_ID, SESSION_ID);

    expect(await repo.listAnswers(USER_ID)).toEqual([]);
    expect(await repo.listSessionAnswers(USER_ID, SESSION_ID)).toEqual([]);
  });

  it("omits predicted_text from the response body (Req 4.5)", async () => {
    const repo = new InMemoryVaultRepository();
    const { claude } = makeClaude();

    const result = await nextCheckIn(
      repo,
      claude,
      PROMPTS,
      USER_ID,
      SESSION_ID,
    );

    expect(result).not.toBeNull();
    // No predicted_text key, and the predicted text never appears in the wire body.
    expect(result).not.toHaveProperty("predicted_text");
    expect(Object.keys(result!)).toEqual(["prediction_id", "prompt"]);
    expect(JSON.stringify(result)).not.toContain(PREDICTED_TEXT);
  });

  it("returns c01 when nothing is answered in the session", async () => {
    const repo = new InMemoryVaultRepository();
    const { claude } = makeClaude();

    const result = await nextCheckIn(
      repo,
      claude,
      PROMPTS,
      USER_ID,
      SESSION_ID,
    );

    expect(result!.prompt).toEqual({ id: "c01", text: PROMPTS[0].text });
  });

  it("returns the lowest unanswered prompt (c02 once c01 is answered)", async () => {
    const repo = new InMemoryVaultRepository();
    const { claude } = makeClaude();

    await seedAnswered(repo, "c01");

    const result = await nextCheckIn(
      repo,
      claude,
      PROMPTS,
      USER_ID,
      SESSION_ID,
    );

    expect(result!.prompt).toEqual({ id: "c02", text: PROMPTS[1].text });
  });
});
