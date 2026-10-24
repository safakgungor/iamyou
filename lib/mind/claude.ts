/**
 * Server-only Claude calls for the mind tree. Same call rules as
 * `lib/claude/index.ts`: model `claude-opus-5-5`, no sampling parameters, no
 * prefill (one system prompt and one user message), and `stop_reason ===
 * 'refusal'` checked before the output is read.
 *
 *  | Function        | API                  | effort | Output                         |
 *  | --------------- | -------------------- | ------ | ------------------------------ |
 *  | groupEntries    | messages.parse (zod) | low    | branches → nodes → entry ids   |
 *  | answerFromVault | messages.parse (zod) | low    | status, answer, entry ids      |
 *
 * Both return `null` on refusal, an unparseable result, a timeout or any API
 * error; the caller then falls back to keywords, so the screen never breaks.
 * Neither result is trusted: `sanitizeTree` and `askMind` check every id.
 *
 * The client is injectable (optional last argument) so tests pass a mock.
 */

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

import type { VaultEntry } from '../db/vault-repository';
import type { MindClaude } from './types';
import {
  ASK_SYSTEM,
  GROUPING_SYSTEM,
  buildAskUserMessage,
  buildGroupingUserMessage,
} from './prompts';
import {
  ClaudeAnswerSchema,
  ClaudeTreeSchema,
  type ClaudeAnswer,
  type ClaudeTree,
} from './schemas';

if (typeof window !== 'undefined') {
  throw new Error('lib/mind/claude is server-only and must not run in the browser');
}

const MODEL = 'claude-opus-5-5';

/** The grouping runs in the background, so it may take its time. */
const GROUPING_TIMEOUT_MS = 55_000;
const GROUPING_MAX_TOKENS = 8_000;

/** The ask is awaited by the user. */
const ASK_TIMEOUT_MS = 25_000;
const ASK_MAX_TOKENS = 2_000;

export function createMindClaudeClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set');
  }
  return new Anthropic({ apiKey });
}

function logFailure(call: string, error: unknown): void {
  const status = error instanceof Anthropic.APIError ? ` ${error.status}` : '';
  const name = error instanceof Error ? error.name : 'unknown error';
  console.warn(`[mind] ${call} fell back to keywords (${name}${status})`);
}

/** Sorts the entries into the five branches. `null` when the call fails. */
export async function groupEntries(
  entries: readonly VaultEntry[],
  client?: Anthropic,
): Promise<ClaudeTree | null> {
  try {
    const message = await (client ?? createMindClaudeClient()).messages.parse(
      {
        model: MODEL,
        max_tokens: GROUPING_MAX_TOKENS,
        output_config: { effort: 'low', format: zodOutputFormat(ClaudeTreeSchema) },
        system: GROUPING_SYSTEM,
        messages: [{ role: 'user', content: buildGroupingUserMessage(entries) }],
      },
      { timeout: GROUPING_TIMEOUT_MS, maxRetries: 1 },
    );
    if (message.stop_reason === 'refusal') return null;
    const parsed = ClaudeTreeSchema.safeParse(message.parsed_output);
    return parsed.success ? parsed.data : null;
  } catch (error) {
    logFailure('groupEntries', error);
    return null;
  }
}

/** Answers a question from the vault entries only. `null` when the call fails. */
export async function answerFromVault(
  question: string,
  entries: readonly VaultEntry[],
  client?: Anthropic,
): Promise<ClaudeAnswer | null> {
  try {
    const message = await (client ?? createMindClaudeClient()).messages.parse(
      {
        model: MODEL,
        max_tokens: ASK_MAX_TOKENS,
        output_config: { effort: 'low', format: zodOutputFormat(ClaudeAnswerSchema) },
        system: ASK_SYSTEM,
        messages: [{ role: 'user', content: buildAskUserMessage(question, entries) }],
      },
      { timeout: ASK_TIMEOUT_MS, maxRetries: 0 },
    );
    if (message.stop_reason === 'refusal') return null;
    const parsed = ClaudeAnswerSchema.safeParse(message.parsed_output);
    return parsed.success ? parsed.data : null;
  } catch (error) {
    logFailure('answerFromVault', error);
    return null;
  }
}

/** The production collaborator: both calls on one client per request. */
export function defaultMindClaude(client?: Anthropic): MindClaude {
  return {
    groupEntries: (entries) => groupEntries(entries, client),
    answerFromVault: (question, entries) => answerFromVault(question, entries, client),
  };
}
