/**
 * zod schemas for the twin-loop's server-only Claude layer.
 *
 * This module holds the Claude call schemas — the shapes the server-only Claude
 * layer (`lib/claude/index.ts`) parses out of the model: prediction, grading,
 * spoken reply, and screening. (Req 6.1)
 *
 * The API route request/response schemas live in the client-safe
 * `lib/api-schemas.ts` (which imports only `zod`) so that client components can
 * import the response types without reaching into this server-only layer. They
 * are re-exported here so existing server-side imports from
 * `'@/lib/claude/schemas'` keep working. The `export *` below also carries the
 * health-baseline timeline and county schemas (`TimelineResponseSchema`,
 * `CountyResponseSchema` and their types) for the server routes.
 */

import { z } from 'zod';

export * from '../api-schemas';

/* -------------------------------------------------------------------------- */
/* Claude call schemas                                                        */
/* -------------------------------------------------------------------------- */

/** The predicted answer text returned by `predictAnswer`. (Req 6.1) */
export const PredictionSchema = z.object({
  prediction: z.string(),
});
export type Prediction = z.infer<typeof PredictionSchema>;

/**
 * The grading result returned by `gradeAnswer`:
 * `{ score, rationale, crisis, genetics_question }`. (Req 6.1)
 */
export const GradingSchema = z.object({
  score: z.number(),
  rationale: z.string(),
  crisis: z.boolean(),
  genetics_question: z.boolean(),
});
export type Grading = z.infer<typeof GradingSchema>;

/** The one-sentence spoken reply returned by `spokenReply`. (Req 6.5) */
export const SpokenReplySchema = z.object({
  reply: z.string(),
});
export type SpokenReply = z.infer<typeof SpokenReplySchema>;

/**
 * The screening result returned by `screenText`:
 * `{ crisis, genetics_question }`. Used by the correction route. (Req 9.2, 9.4)
 */
export const ScreeningSchema = z.object({
  crisis: z.boolean(),
  genetics_question: z.boolean(),
});
export type Screening = z.infer<typeof ScreeningSchema>;

/**
 * The draft text returned by `draftReply` for `assistant-tasks`:
 * `{ draft }`. Parsed out of the model in the server-only Claude layer.
 * (Req 3.3, 7.4)
 */
export const DraftSchema = z.object({
  draft: z.string(),
});
export type Draft = z.infer<typeof DraftSchema>;

/**
 * The `familyAnswer` output schema for care-outputs family mode, built per call
 * from the ids of the entries that were sent, so the output format itself
 * limits `cited_entry_ids` to those ids. (care-outputs Req 9.5)
 */
export function familyAnswerSchemaFor(ids: readonly [string, ...string[]]) {
  return z.object({
    answer: z.string(),
    cited_entry_ids: z.array(z.enum(ids)),
  });
}
