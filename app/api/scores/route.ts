/**
 * `GET /api/scores?session_id=...` (Req 8.1, 8.2, 8.3)
 *
 * Returns `{ session_score, weekly_trend }` for the authenticated caller:
 *   - `session_score` is the mean of this session's already-clamped scores,
 *     via `sessionScore` (Req 8.1).
 *   - `weekly_trend` is the mean clamped score per ISO week over *all* of the
 *     caller's answers, via `weeklyTrend` (Req 8.2, 8.3).
 *
 * The route handler is a thin shell: it authenticates the caller (401 when
 * there is none), reads the `session_id` query param, and delegates the actual
 * computation to the pure, repository-backed `getScores` helper so it can be
 * unit-tested with `InMemoryVaultRepository` (task 15.2).
 */

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/db/supabase-server';
import {
  SupabaseVaultRepository,
  type VaultRepository,
} from '@/lib/db/vault-repository';
import { weeklyTrend } from '@/lib/score';
import { sessionScore } from '@/lib/check-in';
import {
  ScoresResponseSchema,
  type ScoresResponse,
} from '@/lib/claude/schemas';

/**
 * Computes the scores payload for `userId`.
 *
 * `session_score` comes from this session's clamped answer scores; the stored
 * `score` values are already clamped into [0, 1] by the answer route. The
 * `weekly_trend` is computed over every answer the caller owns. The result is
 * validated against `ScoresResponseSchema` before it is returned.
 */
export async function getScores(
  repo: VaultRepository,
  userId: string,
  sessionId: string
): Promise<ScoresResponse> {
  const sessionAnswers = await repo.listSessionAnswers(userId, sessionId);
  const allAnswers = await repo.listAnswers(userId);

  const payload = {
    session_score: sessionScore(sessionAnswers.map((a) => a.score)),
    weekly_trend: weeklyTrend(
      allAnswers.map((a) => ({ createdAt: a.createdAt, score: a.score }))
    ),
  };

  return ScoresResponseSchema.parse(payload);
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
  const scores = await getScores(repo, user.id, sessionId);

  return NextResponse.json(scores);
}
