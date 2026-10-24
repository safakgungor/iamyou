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

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import TwinPortrait from '@/components/twin-portrait';
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

  const synthetic = (
    <span className="rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted shadow-[inset_0_0_0_1px_var(--color-line)]">
      Synthetic data
    </span>
  );

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-5 px-5 pb-10 pt-3">
      <header className="flex items-center justify-between">
        <Link href="/home" className="label transition-colors hover:text-ink">
          ← Hub
        </Link>
        {synthetic}
      </header>

      {/* While the next prompt loads, the twin is making its blind prediction
          (Req 4): show it working, never what it predicted. */}
      {phase === 'loading' && (
        <section className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <div className="h-56 w-full">
            <TwinPortrait shape="twin" waking count={8000} pointSize={10} />
          </div>
          <p className="text-[20px] font-light tracking-[-0.01em]">The twin is answering first…</p>
          <p className="label text-[10px]">Its guess stays hidden until you answer</p>
        </section>
      )}

      {phase === 'error' && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700"
        >
          <p className="text-sm">{errorMessage ?? 'Something went wrong.'}</p>
          <button
            type="button"
            onClick={nextPrompt}
            className="self-start rounded-full border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100"
          >
            Try again
          </button>
        </div>
      )}

      {/* The prompt is shown while answering and after the reveal, but the
          twin's prediction is never shown until a result exists (Req 4.5). */}
      {(phase === 'answering' || phase === 'revealed') && prompt && (
        <section className="flex flex-col gap-3 pt-6">
          <p className="label text-cyan-ink">Today&apos;s question</p>
          <h1 className="text-[30px] font-light leading-[1.1] tracking-[-0.03em]">{prompt.text}</h1>
        </section>
      )}

      {phase === 'answering' && (
        <section className="flex flex-col gap-3">
          <p className="flex items-center gap-2 text-sm text-muted">
            <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full bg-cyan shadow-[0_0_0_4px_rgb(54_209_240/0.2)]" />
            The twin has answered. Now you.
          </p>

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
            className="glass w-full resize-none p-4 text-[16px] leading-relaxed outline-none placeholder:text-muted/70 focus:shadow-[inset_0_0_0_2px_var(--color-cyan-ink)] disabled:opacity-60"
          />
          {speech.supported && speech.startListening && (
            <button
              type="button"
              onClick={() => speech.startListening?.()}
              disabled={submitting}
              className="inline-flex h-11 items-center gap-2 self-start rounded-full bg-white/70 px-4 text-[15px] shadow-[inset_0_0_0_1px_var(--color-line)] transition-colors hover:bg-white disabled:opacity-60"
            >
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
              </svg>
              Speak your answer
            </button>
          )}

          <button
            type="button"
            onClick={submitAnswer}
            disabled={submitting || answer.trim().length === 0}
            className="mt-2 inline-flex h-14 items-center justify-center gap-2 rounded-full bg-ink text-[16px] font-medium text-white shadow-[0_14px_30px_-16px_rgb(24_33_46/0.7)] transition-colors hover:bg-cyan-ink disabled:opacity-40"
          >
            {submitting ? 'Comparing with the twin…' : 'Reveal the twin’s guess'}
          </button>
        </section>
      )}

      {phase === 'revealed' && result && (
        <section className="flex flex-col gap-4">
          {result.kind === 'support' ? (
            // Crisis branch: support message only — no score, no prediction, no
            // reply (Req 9.1).
            <div role="alert" className="glass flex flex-col gap-2 border-l-4 border-l-cyan-ink p-5">
              <p className="label text-cyan-ink">Support</p>
              <p className="text-[16px] leading-relaxed">{result.message}</p>
            </div>
          ) : (
            // Scored branch: reveal prediction + score + reply (Req 6.5, 8.1).
            // For a genetics question the reply is already the Counselor_Message
            // set server-side (Req 9.3).
            <>
              <div className="glass flex flex-col gap-4 p-5">
                <div className="flex items-baseline justify-between">
                  <span className="label">Match</span>
                  <span className="text-[46px] font-light leading-none tracking-[-0.04em]">
                    {Math.round(result.score * 100)}%
                  </span>
                </div>
                <span className="block h-1.5 overflow-hidden rounded-full bg-ink/10">
                  <span
                    className="block h-full rounded-full bg-gradient-to-r from-cyan to-cyan-ink"
                    style={{ width: `${Math.round(result.score * 100)}%` }}
                  />
                </span>
                <div className="flex flex-col gap-3 border-t border-line pt-4">
                  <div className="flex flex-col gap-1">
                    <span className="label">The twin guessed</span>
                    <p className="text-[16px] leading-relaxed">{result.prediction}</p>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="label">You said</span>
                    <p className="text-[16px] leading-relaxed">{answer}</p>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-1 rounded-[22px_22px_22px_6px] bg-white/80 p-4 shadow-[inset_0_0_0_1px_var(--color-line)]">
                <span className="label text-cyan-ink">Twin</span>
                <p className="text-[16px] leading-relaxed">{result.reply}</p>
              </div>
            </>
          )}

          {/* A one-sentence correction is only meaningful for a scored result;
              in the support branch we point to help rather than ask the user to
              teach the twin. */}
          {result.kind === 'scored' && (
            <div className="glass flex flex-col gap-3 p-5">
              <div className="flex flex-col gap-1">
                <h2 className="label">Teach the twin</h2>
                <p className="text-sm text-muted">Something it got wrong? One sentence is enough.</p>
              </div>
              {correctionResult && correctionResult.kind === 'support' && (
                <p role="alert" className="rounded-2xl border-l-4 border-l-cyan-ink bg-white/80 p-3 text-sm">
                  {correctionResult.message}
                </p>
              )}
              {correctionResult && correctionResult.kind === 'counselor' && (
                <p role="alert" className="rounded-2xl border-l-4 border-l-cyan-ink bg-white/80 p-3 text-sm">
                  {correctionResult.message}
                </p>
              )}
              {correctionResult && correctionResult.kind === 'stored' && (
                <p className="text-sm text-cyan-ink">Saved. The twin will remember that.</p>
              )}

              {!correctionLocked && (
                <>
                  <textarea
                    aria-label="One-sentence correction"
                    value={correctionText}
                    onChange={(e) => setCorrectionText(e.target.value)}
                    rows={2}
                    maxLength={MAX_CORRECTION_CHARS}
                    placeholder="Actually, I…"
                    disabled={correctionSubmitting}
                    className="w-full resize-none rounded-2xl bg-white/80 p-3 text-[15px] shadow-[inset_0_0_0_1px_var(--color-line)] outline-none focus:shadow-[inset_0_0_0_2px_var(--color-cyan-ink)] disabled:opacity-60"
                  />
                  <div className="flex items-center justify-between">
                    <span className={`font-mono text-[10px] ${correctionTooLong ? 'text-red-600' : 'text-muted'}`}>
                      {correctionText.length}/{MAX_CORRECTION_CHARS}
                      {correctionTooLong ? ' — too long' : ''}
                    </span>
                    <button
                      type="button"
                      onClick={submitCorrection}
                      disabled={
                        correctionSubmitting ||
                        correctionText.trim().length === 0 ||
                        correctionTooLong
                      }
                      className="h-10 rounded-full bg-white/80 px-4 text-sm font-medium shadow-[inset_0_0_0_1px_var(--color-line)] transition-colors hover:bg-white disabled:opacity-50"
                    >
                      {correctionSubmitting ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={nextPrompt}
            className="inline-flex h-14 items-center justify-center gap-2 rounded-full bg-ink text-[16px] font-medium text-white transition-colors hover:bg-cyan-ink"
          >
            Next question <span aria-hidden="true">→</span>
          </button>
        </section>
      )}
    </main>
  );
}
