'use client';

/**
 * app/check-in/page.tsx — the twin-loop check-in UI. (Task 19.4)
 *
 * Implements the predict-and-correct loop from the design's check-in sequence:
 *
 *   1. Generate a session_id on mount (crypto.randomUUID).
 *   2. GET /api/checkin/next?session_id=... → show the prompt only. The twin's
 *      prediction is NEVER shown before the user answers (Req 4.5); the next
 *      response has no predicted_text field anyway.
 *   3. Collect the answer by voice (useSpeech) with a text-input fallback when
 *      speech recognition is unsupported (Req 5.1, 5.2, 5.3).
 *   4. POST /api/checkin/answer → reveal the result:
 *        - kind === 'scored'  → show prediction + score + reply, and speak the
 *          reply (Req 6.5, 8.1).
 *        - kind === 'support' → show the support message only, with no score,
 *          prediction, or reply (Req 9.1).
 *   5. Offer one optional one-sentence correction (max 280 chars) →
 *      POST /api/checkin/correct → handle stored / support / counselor (Req 9.3).
 *   6. Loop to the next prompt.
 *
 * This task depends on components/use-speech.ts (task 19.5), imported below. The
 * documented shape is { supported: boolean, a function to start listening,
 * transcript: string, speak(text) }. Because that hook is authored in parallel
 * and its exact field names may differ slightly, the fields are read defensively
 * through small adapters (see `resolveSpeech`).
 *
 * Styling uses the shared Tailwind visual language (task 19.6): a mobile-first
 * single-column layout, surface cards, a slate accent for primary actions, and
 * red reserved for errors and the crisis support message.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSpeech } from '@/components/use-speech';
import type {
  CheckInNextResponse,
  CheckInResult,
  CheckInCorrectResponse,
} from '@/lib/api-schemas';

const MAX_CORRECTION_CHARS = 280;

/** The stages the loop moves through for a single prompt. */
type Phase =
  | 'loading' // fetching the next prompt
  | 'answering' // prompt shown, collecting the answer
  | 'revealed' // result shown (scored or support)
  | 'error'; // something went wrong fetching/submitting

/**
 * The surface we rely on from the useSpeech hook, after defensive resolution.
 * The hook's documented shape is { supported, listen/start, transcript, speak }.
 */
type ResolvedSpeech = {
  supported: boolean;
  startListening: (() => void) | null;
  transcript: string;
  speak: ((text: string) => void) | null;
};

/**
 * Adapts whatever the useSpeech hook returns into a stable {@link ResolvedSpeech}
 * shape. Prefers the documented field names but tolerates small variations
 * (`listen` vs `start`, missing `speak`, etc.) so the page keeps working even if
 * the parallel hook lands with a slightly different API.
 */
function resolveSpeech(raw: unknown): ResolvedSpeech {
  const hook = (raw ?? {}) as Record<string, unknown>;

  const supported = hook.supported === true;

  const startCandidate =
    (typeof hook.listen === 'function' && hook.listen) ||
    (typeof hook.start === 'function' && hook.start) ||
    (typeof hook.startListening === 'function' && hook.startListening) ||
    null;

  const transcript =
    typeof hook.transcript === 'string' ? hook.transcript : '';

  const speak = typeof hook.speak === 'function' ? hook.speak : null;

  return {
    supported,
    startListening: startCandidate
      ? (startCandidate as () => void)
      : null,
    transcript,
    speak: speak ? (speak as (text: string) => void) : null,
  };
}

export default function CheckInPage() {
  const [sessionId, setSessionId] = useState<string | null>(null);

  const [phase, setPhase] = useState<Phase>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // The current prompt / prediction id from GET /api/checkin/next.
  const [predictionId, setPredictionId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<CheckInNextResponse['prompt'] | null>(
    null,
  );

  // The user's answer and submission state.
  const [answer, setAnswer] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // The revealed result for this prompt.
  const [result, setResult] = useState<CheckInResult | null>(null);

  // Correction state (one per check-in).
  const [correctionText, setCorrectionText] = useState('');
  const [correctionResult, setCorrectionResult] =
    useState<CheckInCorrectResponse | null>(null);
  const [correctionSubmitting, setCorrectionSubmitting] = useState(false);

  // Voice hook, resolved defensively against the documented shape.
  const speech = resolveSpeech(useSpeech());

  // Mirror the live transcript into the answer field while answering.
  useEffect(() => {
    if (phase !== 'answering') return;
    if (speech.transcript) setAnswer(speech.transcript);
  }, [speech.transcript, phase]);

  // Generate the session id once on mount.
  useEffect(() => {
    setSessionId(crypto.randomUUID());
  }, []);

  /** Fetch the next prompt and reset per-prompt state. */
  const loadNext = useCallback(
    async (session: string) => {
      setPhase('loading');
      setErrorMessage(null);
      setResult(null);
      setAnswer('');
      setCorrectionText('');
      setCorrectionResult(null);

      try {
        const res = await fetch(
          `/api/checkin/next?session_id=${encodeURIComponent(session)}`,
        );
        if (!res.ok) {
          throw new Error(`Could not load the next prompt (${res.status}).`);
        }
        const data = (await res.json()) as CheckInNextResponse;
        setPredictionId(data.prediction_id);
        setPrompt(data.prompt);
        setPhase('answering');
      } catch (err) {
        setErrorMessage(
          err instanceof Error ? err.message : 'Could not load the next prompt.',
        );
        setPhase('error');
      }
    },
    [],
  );

  // Load the first prompt once the session id exists.
  const hasStarted = useRef(false);
  useEffect(() => {
    if (!sessionId || hasStarted.current) return;
    hasStarted.current = true;
    void loadNext(sessionId);
  }, [sessionId, loadNext]);

  /** Submit the answer for grading and reveal the result (Req 6.5, 9.1). */
  async function submitAnswer() {
    if (!sessionId || !predictionId) return;
    const trimmed = answer.trim();
    if (!trimmed) return;

    setSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/checkin/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prediction_id: predictionId,
          session_id: sessionId,
          answer: trimmed,
        }),
      });
      if (!res.ok) {
        throw new Error(`Could not submit the answer (${res.status}).`);
      }
      const data = (await res.json()) as CheckInResult;
      setResult(data);
      setPhase('revealed');

      // Speak the twin's reply for a scored result (Req 5.2). A support result
      // carries no reply and nothing is spoken (Req 9.1).
      if (data.kind === 'scored' && speech.speak) {
        speech.speak(data.reply);
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Could not submit the answer.',
      );
      setPhase('error');
    } finally {
      setSubmitting(false);
    }
  }

  /** Submit the optional one-sentence correction (Req 7.1, 7.2, 9.2, 9.4). */
  async function submitCorrection() {
    if (!predictionId) return;
    const text = correctionText.trim();
    if (!text || text.length > MAX_CORRECTION_CHARS) return;

    setCorrectionSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/checkin/correct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prediction_id: predictionId, text }),
      });
      if (!res.ok) {
        throw new Error(`Could not save the correction (${res.status}).`);
      }
      const data = (await res.json()) as CheckInCorrectResponse;
      setCorrectionResult(data);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Could not save the correction.',
      );
    } finally {
      setCorrectionSubmitting(false);
    }
  }

  /** Advance to the next prompt in the loop. */
  function nextPrompt() {
    if (sessionId) void loadNext(sessionId);
  }

  const correctionTooLong = correctionText.length > MAX_CORRECTION_CHARS;
  // A correction may be added at most once per check-in (Req 7.1).
  const correctionLocked =
    correctionResult !== null && correctionResult.kind === 'stored';

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Check-in</h1>

      {phase === 'loading' && (
        <p className="text-sm text-muted">Loading the next prompt…</p>
      )}

      {phase === 'error' && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700"
        >
          <p className="text-sm">{errorMessage ?? 'Something went wrong.'}</p>
          <button
            type="button"
            onClick={nextPrompt}
            className="self-start rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100"
          >
            Try again
          </button>
        </div>
      )}

      {/* The prompt is shown while answering and after the reveal, but the
          twin's prediction is never shown until a result exists (Req 4.5). */}
      {(phase === 'answering' || phase === 'revealed') && prompt && (
        <section className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-surface p-4">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted">
            Prompt
          </h2>
          <p className="text-lg leading-snug">{prompt.text}</p>
        </section>
      )}

      {phase === 'answering' && (
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-medium">Your answer</h2>

          {/* Typing always works; voice is offered on top when the browser
              supports it and fills the same field (Req 5.1, 5.3). */}
          <textarea
            aria-label="Your answer"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            rows={4}
            placeholder={
              speech.supported ? 'Type your answer, or tap Speak…' : 'Type your answer…'
            }
            disabled={submitting}
            className="w-full rounded-lg border border-gray-300 bg-surface p-3 text-base disabled:opacity-50"
          />
          {speech.supported && speech.startListening && (
            <button
              type="button"
              onClick={() => speech.startListening?.()}
              disabled={submitting}
              className="inline-flex items-center gap-2 self-start rounded-full border border-gray-300 bg-surface px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
            >
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
              </svg>
              Speak your answer
            </button>
          )}

          <div>
            <button
              type="button"
              onClick={submitAnswer}
              disabled={submitting || answer.trim().length === 0}
              className="w-full rounded-lg bg-accent px-6 py-3 text-base font-medium text-white disabled:opacity-50"
            >
              {submitting ? 'Scoring…' : 'Submit answer'}
            </button>
          </div>
        </section>
      )}

      {phase === 'revealed' && result && (
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-medium">Result</h2>

          {result.kind === 'support' ? (
            // Crisis branch: support message only — no score, no prediction, no
            // reply (Req 9.1).
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700"
            >
              <p className="text-base leading-relaxed">{result.message}</p>
            </div>
          ) : (
            // Scored branch: reveal prediction + score + reply (Req 6.5, 8.1).
            // For a genetics question the reply is already the Counselor_Message
            // set server-side (Req 9.3).
            <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-surface p-4">
              <p className="text-base">
                <strong className="font-medium text-muted">
                  The twin predicted:
                </strong>{' '}
                {result.prediction}
              </p>
              <p className="text-base">
                <strong className="font-medium text-muted">
                  Score:
                </strong>{' '}
                {Math.round(result.score * 100)}%
              </p>
              <p className="text-base">
                <strong className="font-medium text-muted">
                  Reply:
                </strong>{' '}
                {result.reply}
              </p>
            </div>
          )}

          {/* A one-sentence correction is only meaningful for a scored result;
              in the support branch we point to help rather than ask the user to
              teach the twin. */}
          {result.kind === 'scored' && (
            <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-surface p-4">
              <h3 className="text-sm font-medium">Teach the twin (optional)</h3>
              {correctionResult && correctionResult.kind === 'support' && (
                <p
                  role="alert"
                  className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
                >
                  {correctionResult.message}
                </p>
              )}
              {correctionResult && correctionResult.kind === 'counselor' && (
                <p
                  role="alert"
                  className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"
                >
                  {correctionResult.message}
                </p>
              )}
              {correctionResult && correctionResult.kind === 'stored' && (
                <p className="text-sm text-muted">
                  Thanks — the twin will remember that.
                </p>
              )}

              {!correctionLocked && (
                <>
                  <textarea
                    aria-label="One-sentence correction"
                    value={correctionText}
                    onChange={(e) => setCorrectionText(e.target.value)}
                    rows={2}
                    maxLength={MAX_CORRECTION_CHARS}
                    placeholder="Correct the twin in one sentence…"
                    disabled={correctionSubmitting}
                    className="w-full rounded-lg border border-gray-300 bg-surface p-3 text-base disabled:opacity-50"
                  />
                  <p
                    className={`text-xs ${
                      correctionTooLong ? 'text-red-600' : 'text-muted'
                    }`}
                  >
                    {correctionText.length}/{MAX_CORRECTION_CHARS}
                    {correctionTooLong ? ' — too long' : ''}
                  </p>
                  <button
                    type="button"
                    onClick={submitCorrection}
                    disabled={
                      correctionSubmitting ||
                      correctionText.trim().length === 0 ||
                      correctionTooLong
                    }
                    className="self-start rounded-lg border border-gray-300 bg-surface px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
                  >
                    {correctionSubmitting ? 'Saving…' : 'Save correction'}
                  </button>
                </>
              )}
            </div>
          )}

          <div>
            <button
              type="button"
              onClick={nextPrompt}
              className="w-full rounded-lg bg-accent px-6 py-3 text-base font-medium text-white"
            >
              Next prompt
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
