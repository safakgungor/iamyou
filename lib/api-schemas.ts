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
/* -------------------------------------------------------------------------- */
/* Assistant draft state + shared shapes                                      */
/* -------------------------------------------------------------------------- */

/**
 * The four `draft_state` values and the four `draft_event` values, as zod
 * enums. These mirror the `DraftState`/`DraftEvent` unions in the server-only
 * `lib/drafts.ts`, but are declared here with `zod` only so client components
 * and the request schemas below never reach into server code. (Req 4.1)
 */
export const DraftStateSchema = z.enum([
  'draft',
  'approved',
  'sent',
  'discarded',
]);
export type DraftStateValue = z.infer<typeof DraftStateSchema>;

/** The four `draft_event` inputs to the state machine. (Req 4) */
export const DraftEventSchema = z.enum(['approve', 'send', 'discard', 'edit']);
export type DraftEventValue = z.infer<typeof DraftEventSchema>;

/**
 * The public Draft shape returned by the draft and transition routes:
 * `{ id, inbox_message_id, body, state, sent_at }`. `sent_at` is null until the
 * Draft is sent. (Req 4, 5.3)
 */
export const DraftResponseSchema = z.object({
  id: z.string(),
  inbox_message_id: z.string(),
  body: z.string(),
  state: DraftStateSchema,
  sent_at: z.string().nullable(),
});
export type DraftResponse = z.infer<typeof DraftResponseSchema>;

/* -------------------------------------------------------------------------- */
/* GET /api/assistant/inbox                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A single read-only synthetic Inbox_Message as returned by the inbox route,
 * carrying all six source fields plus the derived `relative_time_label`. (Req
 * 1.3, 2)
 */
export const InboxMessageResponseSchema = z.object({
  id: z.string(),
  from: z.string(),
  subject: z.string(),
  body: z.string(),
  received_days_ago: z.number(),
  synthetic: z.literal(true),
  relative_time_label: z.string(),
});
export type InboxMessageResponse = z.infer<typeof InboxMessageResponseSchema>;

/**
 * Response body for `GET /api/assistant/inbox`: the fixed "Synthetic data"
 * label the screen must display plus the messages. (Req 1.5)
 */
export const InboxResponseSchema = z.object({
  synthetic_label: z.literal('Synthetic data'),
  messages: z.array(InboxMessageResponseSchema),
});
export type InboxResponse = z.infer<typeof InboxResponseSchema>;

/* -------------------------------------------------------------------------- */
/* POST /api/assistant/draft                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Request body for `POST /api/assistant/draft`. Both the voice command and the
 * button resolve to this identical request. (Req 3.1, 3.2)
 */
export const DraftRequestSchema = z.object({
  inbox_message_id: z.string().min(1),
});
export type DraftRequest = z.infer<typeof DraftRequestSchema>;

/** Response body for `POST /api/assistant/draft`: the created Draft. (Req 3.5) */
export const DraftResponseBodySchema = z.object({
  draft: DraftResponseSchema,
});
export type DraftResponseBody = z.infer<typeof DraftResponseBodySchema>;

/* -------------------------------------------------------------------------- */
/* POST /api/assistant/transition                                             */
/* -------------------------------------------------------------------------- */

/**
 * Request body for `POST /api/assistant/transition`: the Draft id, the
 * `draft_event`, and an OPTIONAL edited `body`. The `body` carries the user's
 * edited draft text — 1–2000 characters — and is allowed ONLY with the `edit`
 * event; supplying a `body` with any other event is a validation error (400).
 * (Req 4.6, 4.11, 6.3)
 */
export const TransitionRequestSchema = z
  .object({
    draft_id: z.string().min(1),
    event: DraftEventSchema,
    body: z.string().min(1).max(2000).optional(),
  })
  // A body may accompany only an `edit` event; reject it with any other event.
  .refine((r) => r.body === undefined || r.event === 'edit', {
    path: ['body'],
    message: 'body is only allowed with the edit event',
  });
export type TransitionRequest = z.infer<typeof TransitionRequestSchema>;

/**
 * Response body for `POST /api/assistant/transition`: the updated Draft, or a
 * `{ discarded: true }` acknowledgement when the Draft was discarded (its row
 * is removed). (Req 4.4, 4.5, 6.6)
 */
export const TransitionResponseSchema = z.union([
  z.object({ draft: DraftResponseSchema }),
  z.object({ discarded: z.literal(true) }),
]);
export type TransitionResponse = z.infer<typeof TransitionResponseSchema>;

/* -------------------------------------------------------------------------- */
/* care-outputs: POST /api/summary                                            */
/* -------------------------------------------------------------------------- */

/**
 * Request body for `POST /api/summary`: the person's own words for field 11
 * and a contact for fields 4 and 13. Neither is stored or sent to a model.
 * (care-outputs Req 1.2)
 */
export const SummaryRequestSchema = z.object({
  discuss: z.string().max(500).optional(),
  contact: z.string().max(200).optional(),
});
export type SummaryRequest = z.infer<typeof SummaryRequestSchema>;

/** The six summary features, in field 8 row order. (care-outputs Req 2.1) */
export const SummaryFeatureSchema = z.enum([
  'vocabulary_diversity',
  'mean_sentence_length',
  'filler_rate',
  'sleep_hours',
  'active_minutes',
  'twin_accuracy',
]);

/**
 * One field 8 row: the person's own baseline mean, recent 4-week mean and
 * z-score. There is no target field. (care-outputs Req 2.2–2.4)
 */
export const MeasureRowSchema = z.object({
  feature: SummaryFeatureSchema,
  label: z.string(),
  baselineMean: z.number().nullable(),
  recentMean: z.number().nullable(),
  z: z.number().nullable(),
});
export type MeasureRowResponse = z.infer<typeof MeasureRowSchema>;

/** The 13 text fields' keys. */
export const SummaryTextFieldKeySchema = z.enum([
  'subject',
  'intro',
  'person',
  'from',
  'focus',
  'family_history',
  'dates',
  'data_sources',
  'what_changed',
  'discuss',
  'rtk',
  'questions',
  'footer',
]);

/** A summary field: field 8 carries measure rows, every other field text. */
export const SummaryFieldSchema = z.union([
  z.object({
    n: z.literal(8),
    key: z.literal('measures'),
    label: z.literal('Measures'),
    rows: z.array(MeasureRowSchema).length(6),
  }),
  z.object({
    n: z.number().int().min(1).max(14),
    key: SummaryTextFieldKeySchema,
    label: z.string(),
    text: z.string(),
  }),
]);
export type SummaryFieldResponse = z.infer<typeof SummaryFieldSchema>;

/**
 * Response body for `POST /api/summary`: exactly 14 fields in order, the
 * synthetic flag, and the "Synthetic data" label whenever it is true.
 * (care-outputs Req 1.2, 4.1–4.3)
 */
export const SummaryResponseSchema = z.object({
  fields: z.array(SummaryFieldSchema).length(14),
  synthetic: z.boolean(),
  synthetic_label: z.literal('Synthetic data').nullable(),
});
export type SummaryResponse = z.infer<typeof SummaryResponseSchema>;

/* -------------------------------------------------------------------------- */
/* care-outputs: GET /api/trials                                              */
/* -------------------------------------------------------------------------- */

/** A normalized trial. (care-outputs Req 7.1) */
export const TrialSchema = z.object({
  nctId: z.string(),
  title: z.string(),
  phaseLabel: z.string(),
  conditions: z.array(z.string()),
  status: z.string(),
  cities: z.array(z.string()),
  source: z.enum(['live', 'saved_ma_slice']),
});
export type TrialResponse = z.infer<typeof TrialSchema>;

/**
 * Response body for `GET /api/trials`. One `no_matches` state covers an empty
 * live result and an empty fallback. (care-outputs Req 5.3, 5.7, 6.5)
 */
export const TrialsResponseSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    origin: z.enum(['live', 'cache', 'stale_cache', 'saved_ma_slice']),
    trials: z.array(TrialSchema).min(1),
    search_url: z.string(),
  }),
  z.object({
    status: z.literal('no_matches'),
    trials: z.array(TrialSchema).max(0),
    message: z.string(),
    search_url: z.string(),
  }),
  z.object({
    status: z.literal('no_family_condition'),
    trials: z.array(TrialSchema).max(0),
  }),
]);
export type TrialsResponse = z.infer<typeof TrialsResponseSchema>;

/* -------------------------------------------------------------------------- */
/* care-outputs: GET and POST /api/family                                     */
/* -------------------------------------------------------------------------- */

/** Response body for `GET /api/family`: who may ask. (care-outputs Req 9.1) */
export const FamilyAskersResponseSchema = z.object({
  first_name: z.string().nullable(),
  askers: z.array(z.string()),
  synthetic_label: z.literal('Synthetic data').nullable(),
});
export type FamilyAskersResponse = z.infer<typeof FamilyAskersResponseSchema>;

/** Request body for `POST /api/family`. */
export const FamilyRequestSchema = z.object({
  asker: z.string().min(1).max(200),
  question: z.string().trim().min(1).max(500),
});
export type FamilyRequest = z.infer<typeof FamilyRequestSchema>;

/**
 * Response body for `POST /api/family`: the answer and only the entries it
 * cites, in citation order. (care-outputs Req 10.5, 10.6)
 */
export const FamilyResponseSchema = z.object({
  asker: z.string(),
  answer: z.string(),
  cited_entries: z.array(
    z.object({
      id: z.string(),
      // Never `style_example`: those entries are never sent. (care-outputs Req 9.2)
      kind: z.enum(['story', 'opinion', 'conversation', 'correction']),
      text: z.string(),
    }),
  ),
  synthetic_label: z.literal('Synthetic data').nullable(),
});
export type FamilyResponse = z.infer<typeof FamilyResponseSchema>;
