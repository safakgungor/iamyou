/**
 * Every prompt string used by the server-only Claude layer.
 *
 * This module is pure strings and string builders — no I/O, no SDK calls. The
 * Claude functions in `lib/claude/index.ts` import the system constants here and
 * build their user messages with the builder functions here:
 *
 *  - `predictAnswer`  → PREDICTION_SYSTEM  + buildPredictionUserMessage(request)
 *  - `gradeAnswer`    → GRADING_SYSTEM     + buildGradingUserMessage(prediction, answer)
 *  - `spokenReply`    → SPOKEN_REPLY_SYSTEM + buildSpokenReplyUserMessage(input)
 *  - `screenText`     → SCREENING_SYSTEM   + buildScreeningUserMessage(text)
 *
 * Non-negotiable safety rules enforced in this file (see `.kiro/steering/safety.md`):
 *
 *  - NEVER DIAGNOSE (rule 2): no prompt states or implies the user has, or is
 *    likely to have, any medical condition. (Req 6.7)
 *  - The prediction prompt predicts what the user would *say* from their vault,
 *    it does NOT draft in their style. `style_example` entries are filtered out
 *    upstream by `selectPredictionContext`, and the prompt text is written so the
 *    model never treats context as a style guide. (Req 4.3, 7.4)
 *  - Crisis and genetics questions are surfaced as structured flags, never
 *    interpreted or acted on inside a prompt. (Req 9)
 */

import type { PredictionRequest } from '../prediction';

/* -------------------------------------------------------------------------- */
/* predictAnswer — predict what the user would say, from their vault           */
/* -------------------------------------------------------------------------- */

/**
 * System prompt for `predictAnswer`.
 *
 * The task is PREDICTION, not drafting: guess the substance of what *this* person
 * would actually say to the prompt, grounded in what their vault reveals about
 * their life, views, and relationships. It is explicitly NOT a request to imitate
 * their writing style. It must never state or imply a medical condition. (Req 4.3,
 * 6.7, 7.4)
 */
export const PREDICTION_SYSTEM =
  'You are a digital twin that predicts how a specific person would answer a ' +
  'personal check-in question. You are given context drawn from that person\u2019s ' +
  'vault: their own past conversations, stories, opinions, and corrections they ' +
  'have made to you. Use this context to infer what they actually think, feel, ' +
  'and would say in response to the question.\n\n' +
  'This is a prediction task, not a writing task. Predict the SUBSTANCE of their ' +
  'answer \u2014 the point they would make, the stance they would take, the detail ' +
  'they would mention \u2014 not a stylistic imitation of how they write. Do not ' +
  'try to copy their voice, phrasing, or tone; focus on what they would say, not ' +
  'how they would word it. The context never contains writing-style samples, so ' +
  'treat every entry only as evidence about the person, never as a style guide.\n\n' +
  'Write the predicted answer in the first person, as if it were their reply. Keep ' +
  'it concise and plausible. When the context is thin, make your best grounded ' +
  'guess rather than refusing.\n\n' +
  'Never state or imply that the person has, or is likely to have, any medical or ' +
  'psychological condition. Make no diagnosis and no medical inference of any kind.';

/**
 * Builds the user message for `predictAnswer` from a `PredictionRequest`.
 *
 * The request is produced by `buildPredictionRequest`, which takes no answer
 * parameter and never includes `style_example` context (that filtering is done by
 * `selectPredictionContext`), so the real answer can never reach this message.
 * (Req 4.3, 4.4, 7.4)
 */
export function buildPredictionUserMessage(request: PredictionRequest): string {
  const context =
    request.context.length > 0
      ? request.context
          .map((entry, index) => `${index + 1}. [${entry.kind}] ${entry.text}`)
          .join('\n')
      : '(no vault context available)';

  return (
    'Here is what this person\u2019s vault reveals about them.\n\n' +
    `Vault context:\n${context}\n\n` +
    `Check-in question:\n${request.prompt}\n\n` +
    'Predict, in the first person, what this person would actually say in answer ' +
    'to the question above. Return only the predicted answer.'
  );
}

/* -------------------------------------------------------------------------- */
/* gradeAnswer — compare meaning, return the grading object                    */
/* -------------------------------------------------------------------------- */

/**
 * System prompt for `gradeAnswer`.
 *
 * Grades the twin's prediction against the user's real answer by comparing MEANING,
 * not exact wording, and returns `{ score, rationale, crisis, genetics_question }`.
 * The rationale must never state or imply a medical condition. (Req 6.1, 6.7)
 */
export const GRADING_SYSTEM =
  'You grade how well a digital twin predicted a person\u2019s answer to a ' +
  'check-in question. You are given the twin\u2019s predicted answer and the ' +
  'person\u2019s real answer.\n\n' +
  'Compare the MEANING of the two answers, not their exact wording. A prediction ' +
  'that captures the same substance, stance, and key points as the real answer ' +
  'should score highly even if the wording is completely different. A prediction ' +
  'that misses or contradicts the real answer\u2019s meaning should score low, even ' +
  'if it reuses similar words.\n\n' +
  'Return an object with these fields:\n' +
  '- "score": a number from 0 to 1, where 1 means the prediction fully matches the ' +
  'meaning of the real answer and 0 means it does not match at all.\n' +
  '- "rationale": one or two plain sentences explaining the score by describing ' +
  'how the meanings compared.\n' +
  '- "crisis": true only when the real answer expresses intent to harm oneself, or ' +
  'describes a crisis that needs immediate support; otherwise false.\n' +
  '- "genetics_question": true only when the real answer asks about genetic testing ' +
  'or about a genetic test result; otherwise false.\n\n' +
  'Never state or imply, in the rationale, that the person has or is likely to have ' +
  'any medical or psychological condition. Do not diagnose, interpret symptoms, or ' +
  'offer any medical conclusion. Judge only how closely the prediction\u2019s ' +
  'meaning matches the real answer.';

/**
 * Builds the user message for `gradeAnswer` from the stored prediction and the
 * user's submitted answer. (Req 6.1)
 */
export function buildGradingUserMessage(
  prediction: string,
  answer: string,
): string {
  return (
    `Twin\u2019s predicted answer:\n${prediction}\n\n` +
    `Person\u2019s real answer:\n${answer}\n\n` +
    'Grade how well the prediction matches the meaning of the real answer, and set ' +
    'the crisis and genetics_question flags, following your instructions.'
  );
}

/* -------------------------------------------------------------------------- */
/* spokenReply — one warm, non-diagnostic sentence                             */
/* -------------------------------------------------------------------------- */

/**
 * System prompt for `spokenReply`.
 *
 * Produces exactly one warm, encouraging sentence to speak back to the user after
 * a graded check-in. The sentence must never state or imply a medical condition.
 * (Req 6.5, 6.7)
 */
export const SPOKEN_REPLY_SYSTEM =
  'You are a warm, supportive digital twin speaking one sentence back to a person ' +
  'right after they answered a check-in question and saw how well you predicted ' +
  'their answer.\n\n' +
  'Reply with exactly ONE short, warm, natural sentence that acknowledges their ' +
  'answer and feels like a caring companion, not a clinician. It will be read ' +
  'aloud, so keep it conversational and easy to speak.\n\n' +
  'Never state or imply that the person has, or is likely to have, any medical or ' +
  'psychological condition. Make no diagnosis, give no medical advice, and do not ' +
  'interpret anything as a symptom. Do not mention the numeric score. Return only ' +
  'the single sentence.';

/**
 * Builds the user message for `spokenReply` from the grading rationale, the
 * prediction, and the user's answer. The score is intentionally omitted so the
 * spoken reply never recites a number. (Req 6.5)
 */
export function buildSpokenReplyUserMessage(input: {
  rationale: string;
  prediction: string;
  answer: string;
}): string {
  return (
    `The person was asked a check-in question.\n\n` +
    `Their real answer:\n${input.answer}\n\n` +
    `What you had predicted:\n${input.prediction}\n\n` +
    `How the two compared:\n${input.rationale}\n\n` +
    'Say one warm, non-diagnostic sentence back to them. Return only that sentence.'
  );
}

/**
 * Fixed, gentle, non-diagnostic sentence used when `spokenReply` cannot produce a
 * reply (e.g. the model refuses). Kept here so the fallback copy lives with the
 * prompts it stands in for. (Req 6.5, 6.7)
 */
export const SPOKEN_REPLY_FALLBACK =
  'Thank you for sharing that with me \u2014 I\u2019m glad you took a moment to ' +
  'check in today.';

/* -------------------------------------------------------------------------- */
/* screenText — screen a correction for crisis and genetics                    */
/* -------------------------------------------------------------------------- */

/**
 * System prompt for `screenText`.
 *
 * Screens a free-text correction and returns only `{ crisis, genetics_question }`.
 * It classifies; it never interprets, advises, or diagnoses. (Req 9.2, 9.4)
 */
export const SCREENING_SYSTEM =
  'You screen a short piece of text a person typed and classify it on two ' +
  'dimensions. You do not reply to the person, interpret the text, or give advice ' +
  '\u2014 you only classify.\n\n' +
  'Return an object with these fields:\n' +
  '- "crisis": true only when the text expresses intent to harm oneself, or ' +
  'describes a crisis that needs immediate support; otherwise false.\n' +
  '- "genetics_question": true only when the text asks about genetic testing or ' +
  'about a genetic test result; otherwise false.\n\n' +
  'Never state or imply that the person has, or is likely to have, any medical or ' +
  'psychological condition. Make no diagnosis of any kind. Only set the two flags.';

/**
 * Builds the user message for `screenText` from the text being screened.
 * (Req 9.2, 9.4)
 */
export function buildScreeningUserMessage(text: string): string {
  return (
    `Text to screen:\n${text}\n\n` +
    'Set the crisis and genetics_question flags for this text, following your ' +
    'instructions.'
  );
}
