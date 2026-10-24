/**
 * The pure draft state machine for the assistant-tasks "second self". No I/O.
 *
 * `transition(state, event)` maps a current `DraftState` and a `DraftEvent` to
 * the next `DraftState` with no I/O and no mutation of its inputs. It is the
 * structural enforcement of AGENTS.md rule 4 — nothing is sent without approval
 * — and the primary target of property tests P1, P2, and P3.
 *
 * The draft-safety validator (`validateDraftSafety`) and its `HEALTH_TERMS` /
 * `SCHEDULING_WORDS` constants live alongside the state machine below.
 */

/** A Draft's state; one of exactly these four values. (Req 4.1) */
export type DraftState = 'draft' | 'approved' | 'sent' | 'discarded';

/** An input to the state machine; one of exactly these four values. (Req 4) */
export type DraftEvent = 'approve' | 'send' | 'discard' | 'edit';

/** The valid states, exported for validation and property-test generators. */
export const DRAFT_STATES: readonly DraftState[] = [
  'draft',
  'approved',
  'sent',
  'discarded',
] as const;

/** The valid events, exported for validation and property-test generators. */
export const DRAFT_EVENTS: readonly DraftEvent[] = [
  'approve',
  'send',
  'discard',
  'edit',
] as const;

/**
 * The two terminal states, from which every event returns the same state.
 * (Req 4.8, 4.9 / P3)
 */
export const TERMINAL_STATES: readonly DraftState[] = ['sent', 'discarded'] as const;

/** Narrows an unknown value to a valid `DraftState`. */
export function isDraftState(value: unknown): value is DraftState {
  return (DRAFT_STATES as readonly unknown[]).includes(value);
}

/** Narrows an unknown value to a valid `DraftEvent`. */
export function isDraftEvent(value: unknown): value is DraftEvent {
  return (DRAFT_EVENTS as readonly unknown[]).includes(value);
}

/**
 * Returned by `transition` when either input is not a valid state/event.
 * (Req 4.12 / P2)
 */
export type TransitionError = { error: 'invalid_state' | 'invalid_event' };

/**
 * The pure draft state machine. Maps a current `DraftState` and a `DraftEvent`
 * to the next `DraftState`, with NO I/O and NO mutation of its inputs.
 * (Req 4 / P1, P2, P3)
 *
 * Defined transitions (Req 4.2–4.6):
 *   draft    + approve  -> approved
 *   approved + send     -> sent
 *   draft    + discard  -> discarded
 *   approved + discard  -> discarded
 *   approved + edit     -> draft
 *
 * Every other (valid state, valid event) pair returns the received state
 * unchanged (Req 4.7, 4.8, 4.9, 4.11). In particular `draft + send -> draft`
 * (Req 4.7) and `draft + edit -> draft` (a self-transition — the state is
 * unchanged, while the edit still stores a new body on the edit path, handled
 * by `applyTransition`). Both terminal states are absorbing (Req 4.8, 4.9).
 *
 * When either argument is not a valid state/event, returns a `TransitionError`
 * and mutates nothing (Req 4.12).
 */
export function transition(state: DraftState, event: DraftEvent): DraftState;
export function transition(
  state: unknown,
  event: unknown,
): DraftState | TransitionError;
export function transition(
  state: unknown,
  event: unknown,
): DraftState | TransitionError {
  if (!isDraftState(state)) {
    return { error: 'invalid_state' };
  }
  if (!isDraftEvent(event)) {
    return { error: 'invalid_event' };
  }

  // Terminal states absorb every event. (Req 4.8, 4.9 / P3)
  if (state === 'sent' || state === 'discarded') {
    return state;
  }

  switch (`${state}:${event}`) {
    case 'draft:approve':
      return 'approved'; // Req 4.2
    case 'approved:send':
      return 'sent'; // Req 4.3
    case 'draft:discard':
      return 'discarded'; // Req 4.4
    case 'approved:discard':
      return 'discarded'; // Req 4.5
    case 'approved:edit':
      return 'draft'; // Req 4.6
    default:
      // Every other valid pair returns the received state unchanged —
      // e.g. draft:send -> draft (Req 4.7) and draft:edit -> draft (Req 4.11).
      return state;
  }
}

/* -------------------------------------------------------------------------- */
/* Draft-safety validator (Req 7.1–7.3)                                       */
/* -------------------------------------------------------------------------- */

/**
 * Health terms whose APPEARANCE in a draft is a safety violation *only when the
 * term was not already present in the source message*. `diagnos` is a prefix
 * that matches "diagnose", "diagnosis", and "diagnostic"; matching is
 * case-insensitive. (Req 7.1, 7.2)
 */
export const HEALTH_TERMS: readonly string[] = [
  'diagnos', // prefix: diagnose / diagnosis / diagnostic
  'disease',
  'condition',
  'symptom',
  'risk',
  'dementia',
  "Alzheimer's",
  "Huntington's",
  'ALS',
  'memory loss',
  'genetic',
  'gene',
  'carrier',
  'test result',
  'medication',
  'prescription',
] as const;

/**
 * Scheduling / logistics words that are NEVER treated as health terms. These
 * routinely appear in appointment replies and MUST NOT trigger a violation even
 * when absent from the source message. (Req 7.2)
 */
export const SCHEDULING_WORDS: readonly string[] = [
  'appointment',
  'visit',
  'doctor',
  'Dr.',
  'clinic',
  'office',
  'confirm',
  'reschedule',
] as const;

/**
 * The single health-related guidance sentence a draft may contain. Any
 * stronger or additional guidance is a violation. (Req 7.3)
 */
const ALLOWED_GUIDANCE_SENTENCE = 'You might want to talk to your doctor about this.';

/**
 * A conservative, pure safety screen for Claude-generated draft text. Returns
 * `{ ok: true }` when the draft is safe, or `{ ok: false, reason }` describing
 * the first violation found. No I/O, no mutation of inputs. (Req 7.1–7.3)
 *
 * A draft is rejected when it:
 *   - introduces a `HEALTH_TERMS` term that is absent from `sourceMessageBody`
 *     (matched case-insensitively), i.e. it adds health content not already in
 *     the message being replied to (Req 7.1, 7.2); or
 *   - gives health-related guidance stronger than the single allowed sentence
 *     "You might want to talk to your doctor about this." (Req 7.3).
 *
 * `SCHEDULING_WORDS` are never treated as health terms, so an ordinary reply
 * confirming an appointment with the doctor's office stays safe even when those
 * words are absent from the source message. The exact allowed guidance sentence
 * passes; any additional recommendation, instruction, or interpretation does
 * not.
 */
export function validateDraftSafety(
  draftText: string,
  sourceMessageBody: string,
): { ok: true } | { ok: false; reason: string } {
  const draftLower = draftText.toLowerCase();
  const sourceLower = sourceMessageBody.toLowerCase();

  // (1) Added health content: a HEALTH_TERMS term present in the draft but not
  // in the source message is a violation. (Req 7.1, 7.2)
  for (const term of HEALTH_TERMS) {
    if (containsTerm(draftLower, term) && !containsTerm(sourceLower, term)) {
      return {
        ok: false,
        reason: `Draft introduces health content not present in the source message: "${term}".`,
      };
    }
  }

  // (2) Over-strong health guidance: the draft may contain the one allowed
  // guidance sentence, but nothing stronger. We detect guidance phrasing and
  // reject anything that is not exactly the allowed sentence. (Req 7.3)
  const guidanceViolation = findGuidanceViolation(draftText);
  if (guidanceViolation) {
    return { ok: false, reason: guidanceViolation };
  }

  return { ok: true };
}

/**
 * Whole-word, case-insensitive match, so "ALS" does not fire on "also" and
 * "gene" not on "general". `diagnos` stays a prefix; a trailing plural "s" is
 * allowed for every other term.
 */
function containsTerm(textLower: string, term: string): boolean {
  const t = term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = t === 'diagnos' ? '\\bdiagnos\\w*' : `\\b${t}s?\\b`;
  return new RegExp(pattern).test(textLower);
}

/**
 * Words that make a sentence about health. Guidance phrasing ("you should",
 * "make sure to") is only a violation inside such a sentence, so "You should
 * come by Sunday!" stays a normal reply. (Req 7.3)
 */
const HEALTH_CONTEXT: readonly string[] = [
  ...HEALTH_TERMS,
  'health',
  'medical',
  'treatment',
  'therapy',
  'test',
  'tested',
  'testing',
  'screening',
  'specialist',
  'neurologist',
  'doctor',
  'physician',
  'checkup',
  'check-up',
];

/**
 * Phrases that signal health-related guidance, recommendation, instruction, or
 * interpretation. Their presence is only allowed inside the single permitted
 * sentence; otherwise the draft gives guidance stronger than that sentence.
 * Matched case-insensitively. (Req 7.3)
 */
const GUIDANCE_PHRASES: readonly string[] = [
  'you should',
  'you need to',
  'you must',
  'you have to',
  'make sure to',
  'i recommend',
  'i suggest',
  'i advise',
  'you ought to',
  "it's important that you",
  'it is important that you',
  'be sure to',
];

/**
 * Returns a violation reason when the draft contains health-related guidance
 * stronger than the single allowed sentence, or `null` when it does not. The
 * exact allowed sentence (ignoring surrounding whitespace and case) never
 * triggers a violation, even though it contains the word "doctor". (Req 7.3)
 */
function findGuidanceViolation(draftText: string): string | null {
  const draftLower = draftText.toLowerCase();
  const allowedLower = ALLOWED_GUIDANCE_SENTENCE.toLowerCase();

  // Remove every occurrence of the exact allowed sentence so only *additional*
  // guidance remains to be screened. (Req 7.3)
  const remaining = draftLower.split(allowedLower).join(' ');

  for (const sentence of remaining.split(/[.!?\n]+/)) {
    if (!HEALTH_CONTEXT.some((word) => containsTerm(sentence, word))) continue;
    for (const phrase of GUIDANCE_PHRASES) {
      if (sentence.includes(phrase)) {
        return `Draft includes health guidance stronger than the single allowed sentence: "${phrase}".`;
      }
    }
  }

  return null;
}
