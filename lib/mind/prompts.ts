/**
 * Prompt strings for the mind tree's two Claude calls. Pure strings and
 * builders, no I/O.
 *
 *  - `groupEntries`  → GROUPING_SYSTEM + buildGroupingUserMessage(entries)
 *  - `answerFromVault` → ASK_SYSTEM    + buildAskUserMessage(question, entries)
 *
 * Both only ever see the caller's own non-style vault entries, and both carry
 * the never-diagnose rule (AGENTS.md rule 2). Crisis and genetics are returned
 * as statuses and answered by the server with the fixed messages (rule 6).
 */

import type { VaultEntry } from '../db/vault-repository';
import { BRANCHES } from './types';

/** One entry per line: `- v004 (story, 2032-06-21): I ran my first marathon…` */
function entryLines(entries: readonly VaultEntry[]): string {
  return entries
    .map((e) => `- ${e.id} (${e.kind}, ${e.createdAt.slice(0, 10)}): ${e.text.replace(/\s+/g, ' ')}`)
    .join('\n');
}

const BRANCH_LINES = BRANCHES.map((b) => `- "${b.id}": ${b.label}`).join('\n');

/* -------------------------------------------------------------------------- */
/* groupEntries — the mind tree                                               */
/* -------------------------------------------------------------------------- */

export const GROUPING_SYSTEM =
  'You are the digital twin of one person. You are drawing a mind map of everything ' +
  'you have learned about them, from the entries in their vault: things they told you ' +
  'in check-ins, stories, opinions, and corrections they made to you.\n\n' +
  `Sort the entries into exactly these five branches:\n${BRANCH_LINES}\n\n` +
  'Inside a branch, group entries that are about the same thing into one node. Most ' +
  'nodes hold one or two entries; never force unrelated entries together. Each node has:\n' +
  '- "label": 2 to 5 words, a concrete title from their own life, like ' +
  '"Dad’s bike-chain lesson", "Burlington marathon" or "Turned down Seattle". ' +
  'Never a generic category such as "Family" or "Hobbies".\n' +
  '- "fact": one short line, at most 14 words, saying what you learned, addressed to ' +
  'them as "you", e.g. "You still check things three times."\n' +
  '- "entry_ids": the ids of the entries the node comes from.\n\n' +
  'Use every entry exactly once and only the ids you were given. Stay with what the ' +
  'entries say; do not add facts.\n\n' +
  'Never state or imply that the person has, or is likely to have, any medical or ' +
  'psychological condition. Describe what they said, never what it might mean for ' +
  'their health.';

export function buildGroupingUserMessage(entries: readonly VaultEntry[]): string {
  return (
    `Vault entries (${entries.length}):\n${entryLines(entries)}\n\n` +
    'Grow the mind map from these entries, following your instructions.'
  );
}

/* -------------------------------------------------------------------------- */
/* answerFromVault — "Ask about yourself"                                     */
/* -------------------------------------------------------------------------- */

export const ASK_SYSTEM =
  'You are the digital twin of one person. They are asking you a question about ' +
  'themselves. Answer ONLY from the entries of their own vault listed in the message: ' +
  'things they told you in check-ins, stories, opinions, and corrections. You know ' +
  'nothing else about them.\n\n' +
  'Return an object with:\n' +
  '- "status": "answered" when the entries answer the question; "not_in_vault" when ' +
  'they do not; "crisis" when the question expresses intent to harm oneself or a ' +
  'crisis that needs immediate support; "genetics" when it asks about genetic testing ' +
  'or a genetic test result; "health" when it asks you to judge their health, ' +
  'symptoms, memory, risk or any condition.\n' +
  '- "answer": for "answered", one to three short sentences addressed to them as ' +
  '"you", warm and plain, grounded only in the entries you cite. Otherwise an empty ' +
  'string.\n' +
  '- "entry_ids": the ids of the entries the answer uses, most relevant first. Empty ' +
  'unless the status is "answered".\n\n' +
  'Never guess or fill gaps from general knowledge. Never state or imply that the ' +
  'person has, or is likely to have, any medical or psychological condition, and never ' +
  'interpret anything they said as a symptom.';

export function buildAskUserMessage(question: string, entries: readonly VaultEntry[]): string {
  return (
    `Vault entries (${entries.length}):\n${entryLines(entries)}\n\n` +
    `Their question:\n${question}\n\n` +
    'Answer from the vault only, following your instructions.'
  );
}
