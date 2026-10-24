/**
 * `GET /api/checkin/next?session_id=...` — the blind-prediction route. (Req 4)
 *
 * It picks the lowest-numbered check-in prompt the caller has not yet answered
 * in this session, has the twin predict the answer BEFORE the user responds,
 * stores that prediction, and returns only `{ prediction_id, prompt }`. The
 * response schema has NO `predicted_text` field, so the prediction is never
 * sent to the client before the user answers (Req 4.5).
 *
 * The HTTP handler is a thin shell: it resolves the authenticated caller and
 * the concrete dependencies (repository, Claude client), then delegates all
 * behaviour to `nextCheckIn`, which is pure of Next.js and HTTP so task 12.3
 * can unit-test it with an `InMemoryVaultRepository` and a mocked
 * `predictAnswer`.
 */

import { NextResponse } from 'next/server';

import prompts from '@/data/synthetic/checkin-prompts.json';
import { predictAnswer } from '@/lib/claude';
import { CheckInNextResponseSchema } from '@/lib/claude/schemas';
import type { CheckInNextResponse } from '@/lib/claude/schemas';
import type { VaultRepository } from '@/lib/db/vault-repository';
import { SupabaseVaultRepository } from '@/lib/db/vault-repository';
import { createSupabaseServerClient } from '@/lib/db/supabase-server';
import {
  buildPredictionRequest,
  selectPredictionContext,
} from '@/lib/prediction';

/** A single check-in prompt as stored in `checkin-prompts.json`. */
export type CheckInPrompt = {
  id: string;
  category: string;
  text: string;
};

/** The 20 check-in prompts, ordered by id (`c01`–`c20`). (Req 4.1) */
const CHECK_IN_PROMPTS = prompts as CheckInPrompt[];

/**
 * The minimal slice of the Claude layer this route depends on, so tests can
 * inject a mocked `predictAnswer` without constructing a real client.
 */
export type CheckInClaude = {
  predictAnswer: typeof predictAnswer;
};

/**
 * Core logic for `GET /api/checkin/next`, free of HTTP and Next.js so it can be
 * unit-tested directly (task 12.3).
 *
 * Steps (design "GET /api/checkin/next"):
 *  1. Find which prompts the caller already answered in this session by mapping
 *     each session answer back to its prediction's `promptId`.
 *  2. Pick the LOWEST-NUMBERED prompt not yet answered in the session (prompts
 *     are supplied in id order). Returns `null` when every prompt is answered.
 *  3. Build the prediction context from the vault with `selectPredictionContext`
 *     then `buildPredictionRequest` (no answer parameter), and call
 *     `predictAnswer`. (Req 4.3)
 *  4. Store the predicted text in a `predictions` row. (Req 4.2)
 *  5. Return `{ prediction_id, prompt: { id, text } }` — never the predicted
 *     text. (Req 4.5)
 *
 * @returns the validated next-response body, or `null` when no prompt remains.
 */
export async function nextCheckIn(
  repo: VaultRepository,
  claude: CheckInClaude,
  promptList: CheckInPrompt[],
  userId: string,
  sessionId: string,
): Promise<CheckInNextResponse | null> {
  // 1. Prompt ids already answered in this session.
  const sessionAnswers = await repo.listSessionAnswers(userId, sessionId);
  const answeredPromptIds = new Set<string>();
  for (const answer of sessionAnswers) {
    const prediction = await repo.getPrediction(userId, answer.predictionId);
    if (prediction) {
      answeredPromptIds.add(prediction.promptId);
    }
  }

  // 2. Lowest-numbered unanswered prompt (prompts arrive in id order).
  const prompt = promptList.find((p) => !answeredPromptIds.has(p.id));
  if (!prompt) {
    return null;
  }

  // 3. Blind prediction: context from the vault, no answer in the request.
  const context = selectPredictionContext(await repo.listVaultEntries(userId));
  const request = buildPredictionRequest(prompt.text, context);
  const predictedText = await claude.predictAnswer(request);

  // 4. Store the prediction so the answer route can grade against it.
  const prediction = await repo.createPrediction(userId, {
    promptId: prompt.id,
    predictedText,
  });

  // 5. Response carries the prompt and prediction id only — never the text.
  return CheckInNextResponseSchema.parse({
    prediction_id: prediction.id,
    prompt: { id: prompt.id, text: prompt.text },
  });
}

export async function GET(request: Request): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sessionId =
    new URL(request.url).searchParams.get('session_id') ?? '';

  const repo = new SupabaseVaultRepository(supabase);
  const claude: CheckInClaude = { predictAnswer };

  const result = await nextCheckIn(
    repo,
    claude,
    CHECK_IN_PROMPTS,
    user.id,
    sessionId,
  );

  if (!result) {
    return NextResponse.json(
      { error: 'No prompts remaining in this session' },
      { status: 404 },
    );
  }

  return NextResponse.json(result);
}
