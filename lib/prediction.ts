/**
 * Pure prediction-context logic for the twin-loop.
 *
 * This module has no I/O. It assembles the request Claude uses to predict a
 * user's answer to a check-in prompt from their vault context. Crucially,
 * `buildPredictionRequest` takes no answer parameter, so the real answer can
 * never enter the prediction request (the structural guarantee behind P2).
 */

/** The number of recent narrative entries appended to the prediction context. */
const RECENT_NARRATIVE_LIMIT = 30;

/** The vault entry kinds treated as narrative context for prediction. */
const NARRATIVE_KINDS: ReadonlySet<VaultEntry['kind']> = new Set([
  'story',
  'opinion',
  'conversation',
]);

export type VaultEntry = {
  id: string;
  kind: 'conversation' | 'correction' | 'story' | 'opinion' | 'style_example';
  text: string;
  createdAt: string;
};

export type PredictionRequest = {
  prompt: string;
  context: Array<{ kind: VaultEntry['kind']; text: string }>;
};

/**
 * Selects prediction context: EVERY `correction`, plus the 30 most recent
 * entries of kinds `story | opinion | conversation` by `createdAt` descending.
 * NEVER includes `style_example` (style is for drafting, not for predicting
 * what someone thinks). (Req 7.4)
 */
export function selectPredictionContext(entries: VaultEntry[]): VaultEntry[] {
  const corrections = entries.filter((entry) => entry.kind === 'correction');

  const recentNarrative = entries
    .filter((entry) => NARRATIVE_KINDS.has(entry.kind))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, RECENT_NARRATIVE_LIMIT);

  return [...corrections, ...recentNarrative];
}

/**
 * Assembles the prediction request from a prompt and vault context.
 * Takes NO answer parameter, so the answer can never enter the request.
 * (Req 4.3, 4.4 / P2)
 */
export function buildPredictionRequest(
  prompt: string,
  context: VaultEntry[],
): PredictionRequest {
  return {
    prompt,
    context: context.map((entry) => ({ kind: entry.kind, text: entry.text })),
  };
}
