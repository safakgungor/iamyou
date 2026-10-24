'use client';

/**
 * app/check-in/page.tsx — the twin-loop check-in UI. (Task 19.4)
 *
 * Implements the predict-and-correct loop from the design's check-in sequence:
 *
 *   1. Generate a session_id on mount (crypto.randomUUID).
 *   2. GET /api/checkin/next?session_id=... → show the prompt and the twin's
 *      answer as a sealed card. The prediction is NEVER shown before the user
 *      answers (Req 4.5); the next response has no predicted_text field anyway.
 *   3. Collect the answer by voice (useSpeech) or by typing; typing always works
 *      and voice fills the same field when the browser supports it (Req 5.1,
 *      5.2, 5.3).
 *   4. POST /api/checkin/answer → reveal the result:
 *        - kind === 'scored'  → open the seal on the prediction, count up the
 *          score and type out the reply, and speak the reply (Req 6.5, 8.1).
 *        - kind === 'support' → show the support message only, with no score,
 *          prediction, or reply (Req 9.1).
 *   5. Offer one optional one-sentence correction (max 280 chars) →
 *      POST /api/checkin/correct → handle stored / support / counselor (Req 9.3).
 *   6. "Next question" loops to the next prompt; "Done for today" goes back to
 *      /home. A 404 from next means every prompt in this session is answered.
 *
 * While the twin works (its blind prediction, then the comparison) the twin
 * sphere pulses. Red is reserved for errors.
 */

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import TwinPortrait from '@/components/twin-portrait';
import { useSpeech } from '@/components/use-speech';
import ScreenHeader from '@/components/flow/screen-header';
import SealedAnswer from '@/components/flow/sealed-answer';
import { stagger, useCountUp, useTyped } from '@/components/flow/motion';
import styles from '@/components/flow/flow.module.css';
import type {
  CheckInNextResponse,
  CheckInResult,
  CheckInCorrectResponse,
} from '@/lib/api-schemas';

const MAX_CORRECTION_CHARS = 280;

/** The stages the loop moves through for a single prompt. */
type Phase =
  | 'loading' // fetching the next prompt (the twin is predicting)
  | 'answering' // prompt shown, twin's answer sealed, collecting the answer
  | 'revealed' // result shown (scored or support)
  | 'finished' // every prompt in this session is answered
  | 'error'; // the next prompt could not be loaded

type LoadError = { message: string; signedOut: boolean };

const PRIMARY =
  'tap inline-flex h-14 items-center justify-center gap-2 rounded-full bg-ink text-[16px] font-medium text-white shadow-[0_14px_30px_-16px_rgb(24_33_46/0.7)] transition-colors hover:bg-cyan-ink';
const SECONDARY =
  'tap inline-flex h-14 items-center justify-center gap-2 rounded-full bg-white/70 text-[16px] font-medium shadow-[inset_0_0_0_1px_var(--color-line)] transition-colors hover:bg-white';

export default function CheckInPage() {
  const [sessionId, setSessionId] = useState<string | null>(null);

  const [phase, setPhase] = useState<Phase>('loading');
  const [loadError, setLoadError] = useState<LoadError | null>(null);

  // The current prompt / prediction id from GET /api/checkin/next.
  const [predictionId, setPredictionId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<CheckInNextResponse['prompt'] | null>(null);
  const [questionNumber, setQuestionNumber] = useState(0);

  // The user's answer and submission state.
  const [answer, setAnswer] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // The revealed result for this prompt.
  const [result, setResult] = useState<CheckInResult | null>(null);

  // Correction state (one per check-in).
  const [correctionText, setCorrectionText] = useState('');
  const [correctionResult, setCorrectionResult] = useState<CheckInCorrectResponse | null>(null);
  const [correctionSubmitting, setCorrectionSubmitting] = useState(false);
  const [correctionError, setCorrectionError] = useState<string | null>(null);

  const speech = useSpeech();
  const topRef = useRef<HTMLElement>(null);
  const sealRef = useRef<HTMLElement>(null);

  // Mirror the live transcript into the answer field while answering.
  useEffect(() => {
    if (phase !== 'answering') return;
    if (speech.transcript) setAnswer(speech.transcript);
  }, [speech.transcript, phase]);

  // Generate the session id once on mount.
  useEffect(() => {
    setSessionId(crypto.randomUUID());
  }, []);

  const { reset: resetSpeech, stop: stopListening, stopSpeaking } = speech;

  /** Fetch the next prompt and reset per-prompt state. */
  const loadNext = useCallback(
    async (session: string) => {
      setPhase('loading');
      setLoadError(null);
      setSubmitError(null);
      setResult(null);
      setAnswer('');
      setCorrectionText('');
      setCorrectionResult(null);
      setCorrectionError(null);
      stopListening();
      stopSpeaking();
      resetSpeech();

      try {
        const res = await fetch(`/api/checkin/next?session_id=${encodeURIComponent(session)}`);
        if (res.status === 404) {
          setPhase('finished');
          return;
        }
        if (res.status === 401) {
          setLoadError({ message: 'Start the demo first, then come back for your question.', signedOut: true });
          setPhase('error');
          return;
        }
        if (!res.ok) throw new Error(`Could not load the next prompt (${res.status}).`);
        const data = (await res.json()) as CheckInNextResponse;
        setPredictionId(data.prediction_id);
        setPrompt(data.prompt);
        setQuestionNumber((n) => n + 1);
        setPhase('answering');
      } catch (err) {
        console.warn(err);
        setLoadError({ message: 'The twin lost its train of thought. Give it another go.', signedOut: false });
        setPhase('error');
      }
    },
    [resetSpeech, stopListening, stopSpeaking],
  );

  // Load the first prompt once the session id exists.
  const hasStarted = useRef(false);
  useEffect(() => {
    if (!sessionId || hasStarted.current) return;
    hasStarted.current = true;
    void loadNext(sessionId);
  }, [sessionId, loadNext]);

  // Bring the opened seal into view on reveal.
  useEffect(() => {
    if (phase !== 'revealed') return;
    const frame = requestAnimationFrame(() => {
      (sealRef.current ?? topRef.current)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => cancelAnimationFrame(frame);
  }, [phase]);

  /** Submit the answer for grading and reveal the result (Req 6.5, 9.1). */
  async function submitAnswer() {
    if (!sessionId || !predictionId) return;
    const trimmed = answer.trim();
    if (!trimmed) return;

    stopListening();
    setSubmitting(true);
    setSubmitError(null);
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
      if (!res.ok) throw new Error(`Could not submit the answer (${res.status}).`);
      const data = (await res.json()) as CheckInResult;
      setAnswer(trimmed);
      setResult(data);
      setPhase('revealed');

      // Speak the twin's reply for a scored result (Req 5.2). A support result
      // carries no reply and nothing is spoken (Req 9.1).
      if (data.kind === 'scored') speech.speak(data.reply);
    } catch (err) {
      console.warn(err);
      // Keep the answer so a retry is one tap.
      setSubmitError('That didn’t reach the twin. Your answer is still here; try again.');
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
    setCorrectionError(null);
    try {
      const res = await fetch('/api/checkin/correct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prediction_id: predictionId, text }),
      });
      if (!res.ok) throw new Error(`Could not save the correction (${res.status}).`);
      const data = (await res.json()) as CheckInCorrectResponse;
      setCorrectionResult(data);
    } catch (err) {
      console.warn(err);
      setCorrectionError('Couldn’t save that. Try again.');
    } finally {
      setCorrectionSubmitting(false);
    }
  }

  /** Advance to the next prompt in the loop. */
  function nextPrompt() {
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (sessionId) void loadNext(sessionId);
  }

  function toggleListening() {
    if (speech.listening) {
      speech.stop();
    } else {
      speech.reset();
      speech.listen();
    }
  }

  const correctionTooLong = correctionText.length > MAX_CORRECTION_CHARS;
  // A correction may be added at most once per check-in (Req 7.1).
  const correctionLocked = correctionResult !== null && correctionResult.kind === 'stored';
  const micBlocked = speech.error !== null && !['no-speech', 'aborted'].includes(speech.error);

  const showQuestion = (phase === 'answering' || phase === 'revealed') && prompt;
  const longQuestion = (prompt?.text.length ?? 0) > 64;

  const kicker = showQuestion ? `Today’s question · ${questionNumber}` : 'Daily check-in';
  const title = showQuestion
    ? prompt.text
    : phase === 'finished'
      ? 'That’s every question for today.'
      : phase === 'error'
        ? loadError?.signedOut
          ? 'Meet Maya first.'
          : 'Let’s try that again.'
        : 'The twin is answering first.';

  return (
    <main
      ref={topRef}
      className="mx-auto flex min-h-screen w-full max-w-md scroll-mt-16 flex-col gap-6 px-5 pb-24 pt-3"
    >
      <ScreenHeader
        kicker={kicker}
        title={
          <span key={showQuestion ? prompt.id : phase} className="rise block">
            {title}
          </span>
        }
        titleClassName={showQuestion && longQuestion ? 'text-[28px] leading-[1.1]' : 'text-[36px] leading-[1.02]'}
      />

      {/* While the next prompt loads, the twin is making its blind prediction
          (Req 4): show it working, never what it predicted. */}
      {phase === 'loading' && (
        <section aria-live="polite" className="flex flex-col items-center gap-2 text-center">
          <div className="h-64 w-full">
            <TwinPortrait shape="twin" waking count={8000} pointSize={10} />
          </div>
          <p className="label text-[10px]">Its answer stays sealed until you give yours</p>
        </section>
      )}

      {phase === 'error' && loadError && (
        <section className="rise flex flex-col gap-4">
          <p role="alert" className="text-[16px] leading-relaxed text-muted">
            {loadError.message}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Link href="/home" className={SECONDARY}>
              ← Today
            </Link>
            {loadError.signedOut ? (
              <Link href="/app" className={PRIMARY}>
                Try as Maya
              </Link>
            ) : (
              <button type="button" onClick={nextPrompt} className={PRIMARY}>
                Try again
              </button>
            )}
          </div>
        </section>
      )}

      {phase === 'finished' && (
        <section className="rise flex flex-col gap-4">
          <p className="text-[16px] leading-relaxed text-muted">
            The twin has your answers. It will be a little closer tomorrow.
          </p>
          <Link href="/home" className={PRIMARY}>
            Done for today
          </Link>
        </section>
      )}

      {/* The twin's answer, sealed until the user answers (Req 4.5). A support
          result never opens it: no prediction is shown (Req 9.1). */}
      {showQuestion && result?.kind !== 'support' && (
        <SealedAnswer
          ref={sealRef}
          working={submitting}
          prediction={result?.kind === 'scored' ? result.prediction : undefined}
          answer={result?.kind === 'scored' ? answer : undefined}
          className="rise"
          style={stagger(1)}
        />
      )}

      {phase === 'answering' && (
        <section className="rise flex flex-col gap-3" style={stagger(2)}>
          {/* Typing always works; voice is offered on top when the browser
              supports it and fills the same field (Req 5.1, 5.3). */}
          <div className="glass relative focus-within:shadow-[inset_0_0_0_2px_var(--color-cyan-ink)]">
            <textarea
              aria-label="Your answer"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              rows={4}
              placeholder={speech.supported ? 'Type your answer, or tap Speak…' : 'Type your answer…'}
              disabled={submitting}
              className={`block w-full resize-none bg-transparent p-4 text-[16px] leading-relaxed outline-none placeholder:text-muted/70 disabled:opacity-60 ${
                speech.supported ? 'pb-16' : ''
              }`}
            />
            {speech.supported && (
              <button
                type="button"
                onClick={toggleListening}
                disabled={submitting}
                aria-pressed={speech.listening}
                className={`tap absolute bottom-3 right-3 inline-flex h-11 items-center gap-2 rounded-full px-4 text-[15px] transition-colors disabled:opacity-60 ${
                  speech.listening
                    ? `bg-cyan-ink text-white ${styles.listening}`
                    : 'bg-white/80 shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-white'
                }`}
              >
                <MicIcon />
                {speech.listening ? 'Listening · tap to stop' : 'Speak'}
              </button>
            )}
          </div>
          {micBlocked && <p className="text-sm text-muted">The mic is off for this page. Typing works just as well.</p>}

          {submitError && (
            <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {submitError}
            </p>
          )}

          <button
            type="button"
            onClick={submitAnswer}
            disabled={submitting || answer.trim().length === 0}
            aria-busy={submitting}
            className={`${PRIMARY} mt-1 disabled:opacity-40`}
          >
            {submitting ? (
              <>
                <span aria-hidden="true" className="h-2 w-2 animate-pulse rounded-full bg-cyan motion-reduce:animate-none" />
                Opening the seal…
              </>
            ) : (
              <>
                Reveal <span aria-hidden="true">→</span>
              </>
            )}
          </button>
        </section>
      )}

      {phase === 'revealed' && result && (
        <>
          {result.kind === 'support' ? (
            // Crisis branch: support message only — no score, no prediction, no
            // reply (Req 9.1).
            <div role="alert" className="glass rise flex flex-col gap-2 border-l-4 border-l-cyan-ink p-5">
              <p className="label text-cyan-ink">Support</p>
              <p className="text-[16px] leading-relaxed">{result.message}</p>
            </div>
          ) : (
            // Scored branch: score + reply (Req 6.5, 8.1); the seal above shows
            // the prediction. For a genetics question the reply is already the
            // Counselor_Message set server-side (Req 9.3).
            <>
              <Match score={result.score} />
              <TwinReply text={result.reply} />
            </>
          )}

          {/* A one-sentence correction is only meaningful for a scored result;
              in the support branch we point to help rather than ask the user to
              teach the twin. */}
          {result.kind === 'scored' && (
            <section aria-labelledby="teach-heading" className="glass rise flex flex-col gap-3 p-5" style={stagger(9)}>
              <div className="flex flex-col gap-1">
                <h2 id="teach-heading" className="label">
                  Teach the twin
                </h2>
                {!correctionLocked && (
                  <p className="text-sm text-muted">Something it got wrong? One sentence is enough.</p>
                )}
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
              {correctionLocked && (
                <div role="status" className="rise flex items-start gap-3 rounded-2xl bg-cyan/10 p-4">
                  <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-cyan-ink text-white">
                    <CheckIcon />
                  </span>
                  <p className="flex min-w-0 flex-col gap-1">
                    <span className="text-[15px] font-medium">Saved. The twin will remember that.</span>
                    <span className="text-sm italic text-muted">“{correctionText.trim()}”</span>
                  </p>
                </div>
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
                    className="w-full resize-none rounded-2xl bg-white/80 p-3 text-[16px] shadow-[inset_0_0_0_1px_var(--color-line)] outline-none focus:shadow-[inset_0_0_0_2px_var(--color-cyan-ink)] disabled:opacity-60"
                  />
                  {correctionError && (
                    <p role="alert" className="text-sm text-red-700">
                      {correctionError}
                    </p>
                  )}
                  <div className="flex items-center justify-between gap-3">
                    <span className={`font-mono text-[10px] ${correctionTooLong ? 'text-red-600' : 'text-muted'}`}>
                      {correctionText.length}/{MAX_CORRECTION_CHARS}
                      {correctionTooLong ? ' — too long' : ''}
                    </span>
                    <button
                      type="button"
                      onClick={submitCorrection}
                      disabled={correctionSubmitting || correctionText.trim().length === 0 || correctionTooLong}
                      className="tap inline-flex h-11 items-center gap-2 rounded-full bg-ink px-5 text-[15px] font-medium text-white transition-colors hover:bg-cyan-ink disabled:opacity-40"
                    >
                      {correctionSubmitting ? 'Saving…' : 'Teach the twin'}
                    </button>
                  </div>
                </>
              )}
            </section>
          )}

          <div className="rise grid grid-cols-2 gap-3" style={stagger(10)}>
            <Link href="/home" className={SECONDARY}>
              Done for today
            </Link>
            <button type="button" onClick={nextPrompt} className={PRIMARY}>
              Next question <span aria-hidden="true">→</span>
            </button>
          </div>
        </>
      )}
    </main>
  );
}

/** The match score: counts up while its bar fills, once the seal has opened. */
function Match({ score }: { score: number }) {
  const target = Math.round(Math.min(1, Math.max(0, score)) * 100);
  const value = useCountUp(target, true, 1000, 450);
  const line =
    target >= 75 ? 'It knows you well here.' : target >= 45 ? 'Close, with a few misses.' : 'Still learning this side of you.';

  return (
    <section aria-label={`Match ${target}%`} className="glass rise flex flex-col gap-3 p-5" style={stagger(6)}>
      <div className="flex items-baseline justify-between">
        <span className="label">Match</span>
        <span aria-hidden="true" className="text-[46px] font-light leading-none tracking-[-0.04em] tabular-nums">
          {value}%
        </span>
      </div>
      <span aria-hidden="true" className="block h-1.5 overflow-hidden rounded-full bg-ink/10">
        <span
          className="block h-full origin-left rounded-full bg-gradient-to-r from-cyan to-cyan-ink"
          style={{ transform: `scaleX(${value / 100})` }}
        />
      </span>
      <p className="text-sm text-muted">{line}</p>
    </section>
  );
}

/** The twin's reply, typed out. The full text holds the space from the start. */
function TwinReply({ text }: { text: string }) {
  const duration = Math.min(2400, Math.max(900, text.length * 16));
  const typed = useTyped(text, true, duration, 1300);
  const typing = typed.length < text.length;

  return (
    <section
      aria-label="The twin’s reply"
      className="rise flex flex-col gap-1 rounded-[22px_22px_22px_6px] bg-white/80 p-4 shadow-[inset_0_0_0_1px_var(--color-line)]"
      style={stagger(8)}
    >
      <span className="label text-cyan-ink">Twin</span>
      <p className="grid text-[16px] leading-relaxed">
        <span aria-hidden="true" className="invisible col-start-1 row-start-1">
          {text}
        </span>
        <span aria-hidden="true" className="col-start-1 row-start-1">
          {typed}
          {typing && <span className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[3px] animate-pulse bg-cyan-ink motion-reduce:hidden" />}
        </span>
        <span className="sr-only">{text}</span>
      </p>
    </section>
  );
}

function MicIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}
