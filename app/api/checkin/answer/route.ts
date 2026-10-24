/**
 * `POST /api/checkin/answer` — grade the user's answer against the blind
 * prediction, clamp the score, store the answer, and reveal the result.
 *
 * The HTTP handler is deliberately thin: it reads the authenticated caller,
 * parses the request body, wires up the production `VaultRepository` (Supabase,
 * request-scoped under the caller's `auth.uid()`) and the server-only Claude
 * layer, and delegates every decision to `submitAnswer`. Keeping the logic in a
 * pure-ish helper that takes its collaborators as arguments lets task 13.2 unit
 * test it with `InMemoryVaultRepository` and a mocked Claude client, with no
 * HTTP, auth, or network.
 *
 * Flow (design "POST /api/checkin/answer", Req 6, 9):
 *   1. Require an authenticated caller; 401 if none.
 *   2. Validate the body with `CheckInAnswerRequestSchema`; 400 on parse failure.
 *   3. Load the stored prediction for the caller; 404 if not found / not owned.
 *   4. `gradeAnswer(prediction.predictedText, answer)`.
 *   5. If the grade is `crisis: true` (which also covers the grading-refusal
 *      fail-safe from task 10.3, since that returns `crisis: true`): store NO
 *      answer and NO score, respond `{ kind: 'support', message: SUPPORT_MESSAGE }`,
 *      and skip the rest. (Req 6.1, 6.7, 9.1 / P5)
 *   6. Otherwise: `score = clampScore(raw.score)`, store an `answers` row with
 *      the clamped score, rationale, crisis flag, session id, prediction id, and
 *      answer text; compute the spoken reply with `spokenReply`; shape the
 *      result with `buildCheckInResult` and respond. (Req 6.2, 6.4, 6.5, 9.3)
 *
 * Crisis-storage decision: the design's Error Handling table specifies that the
 * grading-refusal fail-safe stores no answer and no score. Because that
 * fail-safe is indistinguishable at the route from a genuine `crisis: true`
 * grade (both arrive as `{ crisis: true, ... }`), and because the P5 crisis
 * guarantee requires the support result to carry no score / prediction / reply,
 * this route treats EVERY `crisis: true` grade the same way: store nothing and
 * return the support result. This is the simplest and safest reading and is
 * consistent with the Error Handling table.
 *
 * Requirements: 6.1, 6.2, 6.4, 6.5, 6.6, 6.7, 9.1, 9.3.
 */

import { NextResponse } from 'next/server';

import { clampScore } from '../../../../lib/score';
import { buildCheckInResult, type CheckInResult } from '../../../../lib/check-in';
import { SUPPORT_MESSAGE } from '../../../../lib/safety';
import { CheckInAnswerRequestSchema } from '../../../../lib/claude/schemas';
import {
  gradeAnswer as defaultGradeAnswer,
  spokenReply as defaultSpokenReply,
} from '../../../../lib/claude';
import type { Grading } from '../../../../lib/claude/schemas';
import type { VaultRepository } from '../../../../lib/db/vault-repository';
import { SupabaseVaultRepository } from '../../../../lib/db/vault-repository';
import { createSupabaseServerClient } from '../../../../lib/db/supabase-server';

/**
 * The Claude collaborators `submitAnswer` needs, narrowed to the two functions
 * it calls. Injecting this lets task 13.2 pass mocks instead of the real client.
 */
export interface AnswerClaude {
  gradeAnswer(prediction: string, answer: string): Promise<Grading>;
  spokenReply(input: {
    rationale: string;
    prediction: string;
    answer: string;
  }): Promise<string>;
}

/** The parsed, validated request body handled by `submitAnswer`. */
export type SubmitAnswerBody = {
  prediction_id: string;
  session_id: string;
  answer: string;
};

/** The possible outcomes of `submitAnswer`, mapped to HTTP status by the handler. */
export type SubmitAnswerOutcome =
  | { status: 404; body: { error: string } }
  | { status: 200; body: CheckInResult };

/**
 * The testable core of the answer route. Loads the caller's prediction, grades
 * the answer, and either returns the support result (crisis, storing nothing) or
 * stores the clamped answer and returns the scored result.
 *
 * Collaborators (`repo`, `claude`) and the resolved `userId` are passed in so
 * this runs under `InMemoryVaultRepository` + a mocked Claude in task 13.2.
 */
export async function submitAnswer(
  repo: VaultRepository,
  claude: AnswerClaude,
  userId: string,
  body: SubmitAnswerBody,
): Promise<SubmitAnswerOutcome> {
  // 3. Load the stored prediction for the caller; 404 if not found / not owned.
  const prediction = await repo.getPrediction(userId, body.prediction_id);
  if (!prediction) {
    return { status: 404, body: { error: 'Prediction not found' } };
  }

  // 4. Grade the real answer against the blind prediction.
  const grade = await claude.gradeAnswer(prediction.predictedText, body.answer);

  // 5. Crisis (including the grading-refusal fail-safe): store nothing and
  //    return the support result, skipping scoring, storage, and the reply call.
  if (grade.crisis) {
    return {
      status: 200,
      body: { kind: 'support', message: SUPPORT_MESSAGE },
    };
  }

  // 6. Non-crisis: clamp the score and store the answer row.
  const score = clampScore(grade.score);
  await repo.createAnswer(userId, {
    predictionId: prediction.id,
    sessionId: body.session_id,
    answerText: body.answer,
    score,
    rationale: grade.rationale,
    crisis: grade.crisis,
  });

  // Compute the spoken reply (only reached when not a crisis).
  const reply = await claude.spokenReply({
    rationale: grade.rationale,
    prediction: prediction.predictedText,
    answer: body.answer,
  });

  // Shape the user-facing result; `genetics_question` swaps in the counselor
  // message inside `buildCheckInResult`. The stored score is the clamped one.
  const result = buildCheckInResult({
    grade: {
      score,
      rationale: grade.rationale,
      crisis: grade.crisis,
      genetics_question: grade.genetics_question,
    },
    prediction: prediction.predictedText,
    reply,
  });

  return { status: 200, body: result };
}

/**
 * Thin HTTP handler: resolves the caller, validates the body, wires the
 * production collaborators, and delegates to `submitAnswer`.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient();

  // 1. Require an authenticated caller.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2. Validate the request body.
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = CheckInAnswerRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 },
    );
  }

  const repo = new SupabaseVaultRepository(supabase);
  const claude: AnswerClaude = {
    gradeAnswer: (prediction, answer) => defaultGradeAnswer(prediction, answer),
    spokenReply: (input) => defaultSpokenReply(input),
  };

  const outcome = await submitAnswer(repo, claude, user.id, parsed.data);
  return NextResponse.json(outcome.body, { status: outcome.status });
}
