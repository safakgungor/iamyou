/**
 * zod schemas for the mind tree: the two route bodies and the two Claude
 * output shapes.
 *
 * Client-safe (imports only `zod`), so the page can import the response types.
 * The Claude schemas are deliberately loose — no length limits, which
 * structured outputs cannot enforce anyway. Every label, fact and cited id the
 * model returns is checked and trimmed afterwards by `sanitizeTree` and
 * `askMind`, never trusted as-is.
 */

import { z } from 'zod';

import { BRANCH_IDS } from './types';

const BranchIdSchema = z.enum(BRANCH_IDS);

const MindSourceSchema = z.object({
  id: z.string(),
  kind: z.enum(['conversation', 'correction', 'story', 'opinion']),
  created_at: z.string(),
  text: z.string(),
});

const MindNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  fact: z.string(),
  entry_ids: z.array(z.string()).min(1),
});

export const MindTreeSchema = z.object({
  branches: z.array(
    z.object({
      id: BranchIdSchema,
      label: z.string(),
      nodes: z.array(MindNodeSchema),
    }),
  ),
});

/* -------------------------------------------------------------------------- */
/* GET /api/mind                                                              */
/* -------------------------------------------------------------------------- */

/**
 * `pending` is true while Claude is still regrowing the tree for this vault
 * version; the page polls until it turns false.
 */
export const MindResponseSchema = z.object({
  name: z.string(),
  version: z.string(),
  learned: z.number().int().nonnegative(),
  source: z.enum(['model', 'mixed', 'keywords']),
  pending: z.boolean(),
  tree: MindTreeSchema,
  entries: z.array(MindSourceSchema),
});
export type MindResponse = z.infer<typeof MindResponseSchema>;

/* -------------------------------------------------------------------------- */
/* POST /api/mind/ask                                                         */
/* -------------------------------------------------------------------------- */

export const MAX_QUESTION_CHARS = 280;

export const MindAskRequestSchema = z.object({
  question: z.string().trim().min(1).max(MAX_QUESTION_CHARS),
});
export type MindAskRequest = z.infer<typeof MindAskRequestSchema>;

/**
 * `answer` quotes `sources`; `empty` means the vault holds nothing on it;
 * `support`, `counselor` and `health` carry the fixed safety messages and no
 * sources.
 */
export const MindAskResponseSchema = z.object({
  kind: z.enum(['answer', 'empty', 'support', 'counselor', 'health']),
  answer: z.string(),
  sources: z.array(MindSourceSchema),
  source: z.enum(['model', 'keywords', 'rules']),
});
export type MindAskResponse = z.infer<typeof MindAskResponseSchema>;

/* -------------------------------------------------------------------------- */
/* Claude output shapes                                                       */
/* -------------------------------------------------------------------------- */

/** What the grouping call returns before `sanitizeTree` checks it. */
export const ClaudeTreeSchema = z.object({
  branches: z.array(
    z.object({
      branch: BranchIdSchema,
      nodes: z.array(
        z.object({
          label: z.string(),
          fact: z.string(),
          entry_ids: z.array(z.string()),
        }),
      ),
    }),
  ),
});
export type ClaudeTree = z.infer<typeof ClaudeTreeSchema>;

/** What the ask call returns before `askMind` checks the cited ids. */
export const ClaudeAnswerSchema = z.object({
  status: z.enum(['answered', 'not_in_vault', 'crisis', 'genetics', 'health']),
  answer: z.string(),
  entry_ids: z.array(z.string()),
});
export type ClaudeAnswer = z.infer<typeof ClaudeAnswerSchema>;
