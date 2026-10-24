/**
 * Deterministic safety screens for "Ask about yourself" (AGENTS.md rules 2
 * and 6). They run before Claude is called and again on Claude's answer, so
 * the rules hold even when the model call fails or is skipped:
 *
 *  - crisis language → the 988 support message, nothing else;
 *  - a genetic-testing question → the genetic counselor message;
 *  - a question asking the twin to read health into the vault → the doctor
 *    sentence, never an interpretation;
 *  - an answer that sounds like a diagnosis is never shown.
 */

const CRISIS =
  /\b(kill(ing)? myself|suicid\w*|end (it all|my life)|want to die|wanna die|don'?t want to (live|be alive|be here)|hurt(ing)? myself|self[- ]harm|no reason to live|better off dead)\b/i;

const GENETICS =
  /\b(genetic (test\w*|result\w*|screen\w*|counsel\w*)|gene test\w*|(dna|carrier|predictive) test\w*|test(ed)? (positive|negative) for|cag repeats?|brca|apoe\w*|23andme)\b/i;

const HEALTH_SELF =
  /\b(do i have|am i (getting|developing|showing|sick)|will i (get|develop|inherit)|my (risk|chances|odds)|at risk|signs? of|symptoms?|diagnos\w*|early onset|is something wrong with me)\b/i;

const DIAGNOSIS_LANGUAGE =
  /\b(you (may|might|could|probably|likely) (have|be developing)|signs? of|symptoms? of|early (stage|onset|signs?)|diagnos\w*|at (high |higher |increased )?risk (of|for)|consistent with)\b/i;

/** The one health sentence the app may say (AGENTS.md rule 2). */
export const HEALTH_MESSAGE =
  "I keep what you've told me, but I don't read health into it. " +
  'You might want to talk to your doctor about this.';

export function isCrisis(text: string): boolean {
  return CRISIS.test(text);
}

export function isGeneticsQuestion(text: string): boolean {
  return GENETICS.test(text);
}

/** A question that asks the twin to judge the user's own health. */
export function asksForHealthReading(text: string): boolean {
  return HEALTH_SELF.test(text);
}

/** An answer that states or implies a condition must never reach the user. */
export function soundsLikeDiagnosis(text: string): boolean {
  return DIAGNOSIS_LANGUAGE.test(text);
}
