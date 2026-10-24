/**
 * `POST /api/checkin/correct` — store a user's correction to the twin's
 * prediction, after safety screening. (Req 7, 9)
 *
 * The HTTP handler is deliberately thin: it reads the authenticated caller,
 * builds the request-scoped repository and Claude client, and delegates all of
 * the behaviour to the pure-ish `submitCorrection` helper so that behaviour can
 * be unit-tested with an `InMemoryVaultRepository` and a mocked Claude client
 * (task 14.2).
 *
 * Behaviour (design "POST /api/checkin/correct"):
 *  1. Require an authenticated caller; 401 otherwise. (Req 1, 3.3, 3.4)
 *  2. Validate the body with `CheckInCorrectRequestSchema`, which caps `text`
 *     at 280 chars (Req 7.2). A validation failure is a 400 — returned BEFORE
 *     any model call, never a 500.
 *  3. Enforce at most one correction per check-in / `prediction_id` (Req 7.1):
 *     a correction already stored for this check-in is not stored a second
 *     time.
 *  4. `screenText(text)`:
 *       - crisis       ⇒ `{ kind: 'support', message: SUPPORT_MESSAGE }`, store
 *         nothing (Req 9.2);
 *       - genetics_q   ⇒ `{ kind: 'counselor', message: COUNSELOR_MESSAGE }`,
 *         store nothing (Req 9.4);
 *       - a screen that fails safe (`storeNothing`) is treated like a crisis:
 *         store nothing and return the support message;
 *       - otherwise store a `vault_entries` row with `kind = 'correction'` and
 *         return `{ kind: 'stored' }` (Req 7.3). Future predictions include it
 *         because `selectPredictionContext` keeps every correction (Req 7.4).
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 9.2, 9.4.
 */

import { NextResponse } from 'next/server';
import type Anthropic from '@anthropic-ai/sdk';

import { screenText, createClaudeClient } from '@/lib/claude';
import {
  CheckInCorrectRequestSchema,
  type CheckInCorrectResponse,
} from '@/lib/claude/schemas';
import { SUPPORT_MESSAGE, COUNSELOR_MESSAGE } from '@/lib/safety';
import { createSupabaseServerClient } from '@/lib/db/supabase-server';
import {
  SupabaseVaultRepository,
  type VaultRepository,
} from '@/lib/db/vault-repository';

/** A helper result: an HTTP status plus the JSON body to send. */
export type CorrectionResult = {
  status: number;
  body: CheckInCorrectResponse | { error: string };
};

/**
 * A stable, human-readable marker embedded at the front of a stored correction
 * so that, given only the `VaultRepository` API (which does not link a
 * `vault_entries` row to a `prediction_id`), we can still detect whether a
 * correction has already been stored for a given check-in and enforce "at most
 * one correction per check-in". (Req 7.1)
 *
 * The marker is written once at the start of the stored `text`; the text that
 * follows is the user's own correction.
 */
function correctionMarker(predictionId: string): string {
  return `[correction:${predictionId}] `;
}

/**
 * True when the user already has a stored `correction` for this `predictionId`,
 * identified by the marker prefix written when a correction is stored.
 */
function hasCorrectionFor(
  entries: ReadonlyArray<{ kind: string; text: string }>,
  predictionId: string,
): boolean {
  const marker = correctionMarker(predictionId);
  return entries.some(
    (entry) => entry.kind === 'correction' && entry.text.startsWith(marker),
  );
}

/**
 * The core correction behaviour, independent of HTTP and auth plumbing so it can
 * be unit-tested with an in-memory repository and a mocked Claude client.
 *
 * `body` is the already-validated request body (the caller is responsible for
 * rejecting an over-280-char `text` with a 400 before reaching here, so this
 * helper never triggers a model call on invalid input).
 */
export async function submitCorrection(
  repo: VaultRepository,
  claude: Anthropic,
  userId: string,
  body: { prediction_id: string; text: string },
): Promise<CorrectionResult> {
  const { prediction_id, text } = body;

  // Req 7.1 — at most one correction per check-in. If one already exists for
  // this prediction, do not store a second; report the check-in as stored.
  const existing = await repo.listVaultEntries(userId);
  if (hasCorrectionFor(existing, prediction_id)) {
    return { status: 200, body: { kind: 'stored' } };
  }

  const screen = await screenText(text, claude);

  // Fail safe: a screen that could not be completed stores nothing and shows
  // the support message. (Req 9.2)
  if (screen.storeNothing) {
    return { status: 200, body: { kind: 'support', message: SUPPORT_MESSAGE } };
  }

  // Crisis ⇒ support message, store nothing. (Req 9.2)
  if (screen.screening.crisis) {
    return { status: 200, body: { kind: 'support', message: SUPPORT_MESSAGE } };
  }

  // Genetics question ⇒ counselor message, store nothing. (Req 9.4)
  if (screen.screening.genetics_question) {
    return {
      status: 200,
      body: { kind: 'counselor', message: COUNSELOR_MESSAGE },
    };
  }

  // Clean text ⇒ store a correction row and report it stored. (Req 7.3, 7.4)
  await repo.addVaultEntry(userId, {
    kind: 'correction',
    text: `${correctionMarker(prediction_id)}${text}`,
  });

  return { status: 200, body: { kind: 'stored' } };
}

/**
 * Thin HTTP handler: authenticate, validate, delegate to `submitCorrection`.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Req 1, 3.3, 3.4 — no authenticated caller ⇒ 401.
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Parse the JSON body defensively so malformed JSON is a 400, not a 500.
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Req 7.2 — `text` is capped at 280 chars by the schema. A validation failure
  // (including over-length text) is a 400 returned BEFORE any model call.
  const parsed = CheckInCorrectRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const repo = new SupabaseVaultRepository(supabase);
  const claude = createClaudeClient();

  const result = await submitCorrection(repo, claude, user.id, parsed.data);
  return NextResponse.json(result.body, { status: result.status });
}
