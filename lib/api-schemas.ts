/**
 * Client-safe API route request/response schemas for the twin-loop.
 *
 * This module holds every API route request/response body used by the routes
 * in the design, so each route can validate its input and output at the
 * boundary — and so client components can import the inferred response types
 * WITHOUT reaching into the server-only Claude layer (`lib/claude/**`).
 *
 * It imports ONLY `zod`; it must never pull in the Anthropic SDK or any
 * server-only code, so it is safe to import from `'use client'` files. The
 * Claude call schemas (prediction, grading, spoken reply, screening) stay in
 * `lib/claude/schemas.ts`, which re-exports this module for server-side use.
 *
 * The correction text is capped at 280 characters via `.max(280)` (Req 7.2).
 */

import { z } from 'zod';

/* -------------------------------------------------------------------------- */
/* POST /api/demo/start                                                       */
/* -------------------------------------------------------------------------- */

/** Request body for `POST /api/demo/start`: an empty object. */
export const DemoStartRequestSchema = z.object({});
export type DemoStartRequest = z.infer<typeof DemoStartRequestSchema>;

/** Response body for `POST /api/demo/start`: success or an error. */
export const DemoStartResponseSchema = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({ error: z.string() }),
]);
export type DemoStartResponse = z.infer<typeof DemoStartResponseSchema>;

/* -------------------------------------------------------------------------- */
/* GET /api/checkin/next                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Response body for `GET /api/checkin/next`. Carries the prediction id and the
 * prompt only — there is NO `predicted_text` field, so the prediction is never
 * sent before the user answers. (Req 4.5)
 */
export const CheckInNextResponseSchema = z.object({
  prediction_id: z.string(),
  prompt: z.object({
    id: z.string(),
    text: z.string(),
  }),
});
export type CheckInNextResponse = z.infer<typeof CheckInNextResponseSchema>;

/* -------------------------------------------------------------------------- */
/* POST /api/checkin/answer                                                   */
/* -------------------------------------------------------------------------- */

/** Request body for `POST /api/checkin/answer`. */
export const CheckInAnswerRequestSchema = z.object({
  prediction_id: z.string(),
  session_id: z.string(),
  answer: z.string(),
});
export type CheckInAnswerRequest = z.infer<typeof CheckInAnswerRequestSchema>;

/**
 * Response body for `POST /api/checkin/answer`: a `CheckInResult` discriminated
 * union. A crisis yields a support result with no score/prediction/reply; an
 * ordinary answer yields a scored result. (Req 6.5, 9.1)
 */
export const CheckInResultSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('support'),
    message: z.string(),
  }),
  z.object({
    kind: z.literal('scored'),
    score: z.number(),
    prediction: z.string(),
    reply: z.string(),
  }),
]);
export type CheckInResult = z.infer<typeof CheckInResultSchema>;

/** Response body for `POST /api/checkin/answer`. */
export const CheckInAnswerResponseSchema = CheckInResultSchema;
export type CheckInAnswerResponse = z.infer<typeof CheckInAnswerResponseSchema>;

/* -------------------------------------------------------------------------- */
/* POST /api/checkin/correct                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Request body for `POST /api/checkin/correct`. The correction text is capped
 * at 280 characters. (Req 7.2)
 */
export const CheckInCorrectRequestSchema = z.object({
  prediction_id: z.string(),
  text: z.string().max(280),
});
export type CheckInCorrectRequest = z.infer<typeof CheckInCorrectRequestSchema>;

/**
 * Response body for `POST /api/checkin/correct`: a crisis yields a support
 * result, a genetics question yields a counselor result, and clean text that is
 * stored yields `{ kind: 'stored' }`. (Req 7.3, 9.2, 9.4)
 */
export const CheckInCorrectResponseSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('support'),
    message: z.string(),
  }),
  z.object({
    kind: z.literal('counselor'),
    message: z.string(),
  }),
  z.object({
    kind: z.literal('stored'),
  }),
]);
export type CheckInCorrectResponse = z.infer<
  typeof CheckInCorrectResponseSchema
>;

/* -------------------------------------------------------------------------- */
/* GET /api/scores                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Response body for `GET /api/scores`: the session score and the weekly trend
 * keyed by ISO week. (Req 8.1, 8.2)
 */
export const ScoresResponseSchema = z.object({
  session_score: z.number(),
  weekly_trend: z.record(z.string(), z.number()),
});
export type ScoresResponse = z.infer<typeof ScoresResponseSchema>;

/* -------------------------------------------------------------------------- */
/* DELETE /api/vault                                                          */
/* -------------------------------------------------------------------------- */

/** Response body for `DELETE /api/vault`. (Req 3.5) */
export const VaultDeleteResponseSchema = z.object({
  ok: z.literal(true),
});
export type VaultDeleteResponse = z.infer<typeof VaultDeleteResponseSchema>;
