/**
 * Server-only Claude layer for the twin-loop.
 *
 * This module is the ONLY place that talks to the Anthropic API. It must never
 * be imported from client code: it reads the `ANTHROPIC_API_KEY` from the
 * environment and constructs the SDK client. The four functions here each map
 * to one row of the design's "Claude calls" table:
 *
 *  | Function       | API                       | effort | Output                                     |
 *  | -------------- | ------------------------- | ------ | ------------------------------------------ |
 *  | predictAnswer  | messages.create           | medium | prediction text                            |
 *  | gradeAnswer    | messages.parse (zod)      | medium | {score, rationale, crisis, genetics_q...}  |
 *  | spokenReply    | beta.messages.create      | low    | one warm, non-diagnostic sentence          |
 *  | screenText     | messages.parse (zod)      | low    | {crisis, genetics_question}                |
 *
 * Non-negotiable call rules (design "Claude calls" + Error Handling table):
 *
 *  - Model is always `"claude-opus-5-5"`.
 *  - NO `temperature` / `top_p` / `top_k`, and NO assistant prefill. Every call
 *    sends exactly a system prompt and a single user message.
 *  - EVERY call checks `stop_reason === 'refusal'` BEFORE reading content, then
 *    returns a safe fallback:
 *      - `gradeAnswer`  refusal  → fail safe as `crisis: true` (so the answer
 *        route shows the support message and stores nothing). (Req 6.1, 6.7, 9.1)
 *      - `screenText`   refusal  → fail safe as "store nothing" (returned by
 *        signalling the caller should store nothing). (Req 9.2)
 *      - `spokenReply`  refusal  → the fixed gentle sentence `SPOKEN_REPLY_FALLBACK`.
 *        (Req 6.5, 6.7)
 *
 * The client is injectable so task 10.4 can pass a mock: every function takes an
 * optional `client` argument, and `createClaudeClient()` is exported as a factory.
 *
 * Requirements: 4.6, 6.1, 6.6, 6.7, 9.1, 9.2.
 */

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

import type { PredictionRequest } from '../prediction';
import { validateDraftSafety } from '../drafts';
import {
  DRAFT_REPLY_SYSTEM,
  DRAFT_SAFETY_RETRY_SUFFIX,
  GRADING_SYSTEM,
  PREDICTION_SYSTEM,
  SCREENING_SYSTEM,
  SPOKEN_REPLY_SYSTEM,
  SPOKEN_REPLY_FALLBACK,
  buildDraftReplyUserMessage,
  buildGradingUserMessage,
  buildPredictionUserMessage,
  buildScreeningUserMessage,
  buildSpokenReplyUserMessage,
} from './prompts';
import {
  GradingSchema,
  ScreeningSchema,
  type Grading,
  type Screening,
} from './schemas';

/* -------------------------------------------------------------------------- */
/* Server-only guard                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Hard guarantee that this module only runs on the server. If it is ever bundled
 * into and evaluated in a browser, loading it throws instead of leaking the
 * Anthropic key or the prompts to the client. (Req 4.6, 6.6)
 */
if (typeof window !== 'undefined') {
  throw new Error('lib/claude is server-only and must not run in the browser');
}

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

/** The only model this layer calls. (design "Claude calls") */
const MODEL = 'claude-opus-5-5';

/**
 * A fixed output-token ceiling for every call. `max_tokens` is required by the
 * API; the twin-loop outputs (one answer, a short grading object, one sentence,
 * two flags) are all small, so a modest ceiling is plenty.
 */
const MAX_TOKENS = 1024;

/** The beta header that enables server-side fallbacks for `spokenReply`. */
const SPOKEN_REPLY_BETAS = ['server-side-fallback-2026-07-01'] as const;

/**
 * Hard wall-clock ceiling for a single `draftReply` Claude call. If the call
 * does not resolve within this window the draft attempt is abandoned and the
 * function returns `{ ok: false, reason: 'timeout' }`. (Req 3.7)
 */
const DRAFT_REPLY_TIMEOUT_MS = 30_000;

/* -------------------------------------------------------------------------- */
/* Client factory                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Constructs an Anthropic client from the environment. The SDK reads
 * `ANTHROPIC_API_KEY` from `process.env` by default; we pass it explicitly so
 * the dependency is obvious and a missing key fails loudly at construction.
 *
 * This is exported so routes can build one client per request and tests can
 * substitute a mock instead. (Req 4.6, 6.6)
 */
export function createClaudeClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set');
  }
  return new Anthropic({ apiKey });
}

/* -------------------------------------------------------------------------- */
/* Internal helpers                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Concatenates every `type: 'text'` block of a model response into a single
 * string. Non-text blocks (none are expected here) are ignored.
 */
function extractText(
  content: ReadonlyArray<{ type: string; text?: string }>,
): string {
  return content
    .filter(
      (block): block is { type: 'text'; text: string } =>
        block.type === 'text' && typeof block.text === 'string',
    )
    .map((block) => block.text)
    .join('')
    .trim();
}

/* -------------------------------------------------------------------------- */
/* predictAnswer — medium, messages.create, returns prediction text            */
/* -------------------------------------------------------------------------- */

/**
 * Predicts, in the first person, what the user would say to a check-in prompt,
 * grounded only in the vault context carried by the `PredictionRequest`. The
 * request is built by `buildPredictionRequest` / `selectPredictionContext`,
 * which never include `style_example` entries and never carry the real answer.
 * (Req 4.3, 4.6)
 *
 * On refusal (`stop_reason === 'refusal'`) this returns an empty string rather
 * than reading content; the prediction prompt is instructed to make a grounded
 * guess rather than refuse, so a refusal is not expected in normal operation.
 */
export async function predictAnswer(
  request: PredictionRequest,
  client: Anthropic = createClaudeClient(),
): Promise<string> {
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    output_config: { effort: 'medium' },
    system: PREDICTION_SYSTEM,
    messages: [
      { role: 'user', content: buildPredictionUserMessage(request) },
    ],
  });

  if (message.stop_reason === 'refusal') {
    return '';
  }

  return extractText(message.content);
}

/* -------------------------------------------------------------------------- */
/* gradeAnswer — medium, messages.parse (zod), fails safe as crisis            */
/* -------------------------------------------------------------------------- */

/**
 * Grades the twin's prediction against the user's real answer by comparing
 * MEANING, returning `{ score, rationale, crisis, genetics_question }` validated
 * with `GradingSchema`. (Req 6.1)
 *
 * On refusal (`stop_reason === 'refusal'`), or when parsing fails, this FAILS
 * SAFE as `crisis: true` so the answer route shows the support message and
 * stores nothing. (Req 6.1, 6.7, 9.1)
 */
export async function gradeAnswer(
  prediction: string,
  answer: string,
  client: Anthropic = createClaudeClient(),
): Promise<Grading> {
  const message = await client.messages.parse({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    output_config: {
      effort: 'medium',
      format: zodOutputFormat(GradingSchema),
    },
    system: GRADING_SYSTEM,
    messages: [
      { role: 'user', content: buildGradingUserMessage(prediction, answer) },
    ],
  });

  if (message.stop_reason === 'refusal') {
    return gradingFailSafe();
  }

  const parsed = GradingSchema.safeParse(message.parsed_output);
  if (!parsed.success) {
    return gradingFailSafe();
  }

  return parsed.data;
}

/**
 * The grading fail-safe value: `crisis: true` with a zero score and no genetics
 * flag, so the answer route shows the support message and stores nothing.
 */
function gradingFailSafe(): Grading {
  return {
    score: 0,
    rationale: '',
    crisis: true,
    genetics_question: false,
  };
}

/* -------------------------------------------------------------------------- */
/* spokenReply — low, beta.messages.create, returns one warm sentence          */
/* -------------------------------------------------------------------------- */

/**
 * Produces exactly one warm, non-diagnostic sentence to read back to the user
 * after a graded check-in. Uses the beta messages endpoint with server-side
 * fallbacks enabled. (Req 6.5)
 *
 * On refusal (`stop_reason === 'refusal'`) or an empty result it returns the
 * fixed gentle sentence `SPOKEN_REPLY_FALLBACK`. (Req 6.5, 6.7)
 */
export async function spokenReply(
  input: { rationale: string; prediction: string; answer: string },
  client: Anthropic = createClaudeClient(),
): Promise<string> {
  const message = await client.beta.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    betas: [...SPOKEN_REPLY_BETAS],
    fallbacks: 'default',
    output_config: { effort: 'low' },
    system: SPOKEN_REPLY_SYSTEM,
    messages: [
      { role: 'user', content: buildSpokenReplyUserMessage(input) },
    ],
  });

  if (message.stop_reason === 'refusal') {
    return SPOKEN_REPLY_FALLBACK;
  }

  const reply = extractText(message.content);
  return reply.length > 0 ? reply : SPOKEN_REPLY_FALLBACK;
}

/* -------------------------------------------------------------------------- */
/* screenText — low, messages.parse (zod), fails safe as "store nothing"       */
/* -------------------------------------------------------------------------- */

/**
 * The result of screening a correction. `screening` carries the two flags when
 * the screen succeeded; `storeNothing` is `true` when the screen refused (or the
 * result could not be parsed), telling the caller to fail safe and store
 * nothing. (Req 9.2)
 */
export type ScreenResult =
  | { storeNothing: false; screening: Screening }
  | { storeNothing: true };

/**
 * Screens a free-text correction and returns `{ crisis, genetics_question }`
 * validated with `ScreeningSchema`, wrapped in a `ScreenResult`. (Req 9.2)
 *
 * On refusal (`stop_reason === 'refusal'`), or when parsing fails, this FAILS
 * SAFE by signalling `storeNothing: true`, so the correction route stores
 * nothing. (Req 9.2)
 */
export async function screenText(
  text: string,
  client: Anthropic = createClaudeClient(),
): Promise<ScreenResult> {
  const message = await client.messages.parse({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    output_config: {
      effort: 'low',
      format: zodOutputFormat(ScreeningSchema),
    },
    system: SCREENING_SYSTEM,
    messages: [
      { role: 'user', content: buildScreeningUserMessage(text) },
    ],
  });

  if (message.stop_reason === 'refusal') {
    return { storeNothing: true };
  }

  const parsed = ScreeningSchema.safeParse(message.parsed_output);
  if (!parsed.success) {
    return { storeNothing: true };
  }

  return { storeNothing: false, screening: parsed.data };
}

/* -------------------------------------------------------------------------- */
/* draftReply — medium, messages.create, 30s timeout + safety-with-one-retry   */
/* -------------------------------------------------------------------------- */

/**
 * A sentinel thrown internally when a `draftReply` Claude call exceeds
 * `DRAFT_REPLY_TIMEOUT_MS`. It is caught inside `draftReply` and turned into a
 * `{ ok: false, reason: 'timeout' }` result; it never escapes the module.
 */
const DRAFT_TIMEOUT = Symbol('draft-timeout');

/**
 * Races a promise against a wall-clock timeout. Resolves with the promise's
 * value if it settles first; rejects with the `DRAFT_TIMEOUT` sentinel if the
 * timeout wins. The timer is always cleared so a settled call never leaks a
 * pending timeout.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(DRAFT_TIMEOUT), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timer);
  }) as Promise<T>;
}

/** The outcome of drafting a reply: a safe draft, or a typed failure reason. */
export type DraftReplyResult =
  | { ok: true; text: string }
  | { ok: false; reason: 'timeout' | 'refusal' | 'unsafe' };

/**
 * Drafts a short reply to an Inbox_Message in the user's voice, grounded only
 * in the supplied `styleExamples` (used as a tone/phrasing guide, never as a
 * source of facts). The draft is screened for safety before it is returned, so
 * no unsafe text ever leaves this server-only layer. (Req 3.6, 3.7, 7.4, 7.5)
 *
 * Call rules (matching the rest of this module): model `"claude-opus-5-5"`, no
 * `temperature` / `top_p` / `top_k`, no assistant prefill — exactly a system
 * prompt and one user message. `stop_reason === 'refusal'` is checked BEFORE
 * reading content. The whole call is wrapped in a 30-second timeout.
 *
 * Safety flow (Req 7.4, 7.5):
 *   1. Generate a draft and validate it with `validateDraftSafety(text, body)`.
 *   2. If it passes, return `{ ok: true, text }`.
 *   3. If it fails, retry ONCE with `DRAFT_SAFETY_RETRY_SUFFIX` appended to the
 *      user message. If the retry passes, return it.
 *   4. If the retry also fails validation, return `{ ok: false, reason: 'unsafe' }`.
 *
 * On refusal returns `{ ok: false, reason: 'refusal' }`; on timeout returns
 * `{ ok: false, reason: 'timeout' }`. The caller (the draft route) turns any
 * failure into `draft_generation_failed` and creates no Draft; the failing text
 * is never shown to the user.
 */
export async function draftReply(
  input: {
    message: { from: string; subject: string; body: string };
    styleExamples: string[];
  },
  client: Anthropic = createClaudeClient(),
): Promise<DraftReplyResult> {
  const { message, styleExamples } = input;
  const baseUserMessage = buildDraftReplyUserMessage({ message, styleExamples });

  /**
   * Runs one Claude call for the given user message. Returns the extracted
   * draft text, or `'refusal'` when the model refused before producing content.
   */
  async function attempt(
    userMessage: string,
  ): Promise<{ refusal: true } | { refusal: false; text: string }> {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      output_config: { effort: 'medium' },
      system: DRAFT_REPLY_SYSTEM,
      messages: [{ role: 'user', content: userMessage }],
    });

    if (response.stop_reason === 'refusal') {
      return { refusal: true };
    }

    return { refusal: false, text: extractText(response.content) };
  }

  try {
    // First attempt.
    const first = await withTimeout(attempt(baseUserMessage), DRAFT_REPLY_TIMEOUT_MS);
    if (first.refusal) {
      return { ok: false, reason: 'refusal' };
    }
    if (validateDraftSafety(first.text, message.body).ok) {
      return { ok: true, text: first.text };
    }

    // The first draft failed safety: retry ONCE with the reinforcement suffix.
    const retry = await withTimeout(
      attempt(baseUserMessage + DRAFT_SAFETY_RETRY_SUFFIX),
      DRAFT_REPLY_TIMEOUT_MS,
    );
    if (retry.refusal) {
      return { ok: false, reason: 'refusal' };
    }
    if (validateDraftSafety(retry.text, message.body).ok) {
      return { ok: true, text: retry.text };
    }

    // Both the first draft and the single retry failed validation.
    return { ok: false, reason: 'unsafe' };
  } catch (error) {
    if (error === DRAFT_TIMEOUT) {
      return { ok: false, reason: 'timeout' };
    }
    throw error;
  }
}
