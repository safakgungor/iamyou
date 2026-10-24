'use client';

/**
 * `app/family/page.tsx` — family mode (care-outputs Req 9, 10).
 *
 * A relative the person named in their digital will asks how the person would
 * answer a question. The screen shows who is asking (from `GET /api/family`,
 * Req 9.1), takes the question by text or voice, and shows the answer from
 * `POST /api/family` with the text of every vault entry it cites and no other
 * entry (Req 10.5, 10.6). When the vault does not cover a question the answer
 * is "I don't know how {first_name} would answer that." with no entries.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSpeech } from '@/components/use-speech';
import type { FamilyAskersResponse, FamilyResponse } from '@/lib/api-schemas';

const MAX_QUESTION = 500;

/** Questions Maya's vault can answer, to start the demo with one tap. */
const SUGGESTIONS = [
  'How do you make a big decision?',
  'What did Grandpa teach you?',
  'What do you do when you are angry at someone?',
];

const KIND_TEXT: Record<FamilyResponse['cited_entries'][number]['kind'], string> = {
  story: 'Story',
  opinion: 'Opinion',
  conversation: 'Check-in',
  correction: 'Correction',
};

type Status = { kind: 'idle' } | { kind: 'asking' } | { kind: 'error'; message: string };

export default function FamilyPage() {
  const [info, setInfo] = useState<FamilyAskersResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [asker, setAsker] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<(FamilyResponse & { question: string }) | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const speech = useSpeech();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/family');
        if (res.status === 401) throw new Error('Start the demo first: open the app and tap Try as Maya.');
        if (!res.ok) throw new Error(`Family mode is unavailable right now (${res.status}).`);
        const data = (await res.json()) as FamilyAskersResponse;
        if (cancelled) return;
        setInfo(data);
        setAsker(data.askers[0] ?? null);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Family mode is unavailable right now.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // A spoken question fills the box; the relative still taps Ask.
  useEffect(() => {
    if (speech.transcript) setQuestion(speech.transcript.slice(0, MAX_QUESTION));
  }, [speech.transcript]);

  async function ask(text: string) {
    const trimmed = text.trim();
    if (!asker || trimmed.length === 0) return;
    setQuestion(trimmed);
    setStatus({ kind: 'asking' });
    setResult(null);
    try {
      const res = await fetch('/api/family', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asker, question: trimmed }),
      });
      if (res.status === 401) throw new Error('Start the demo first: open the app and tap Try as Maya.');
      if (res.status === 403) throw new Error('Only the people Maya named can use family mode.');
      if (!res.ok) throw new Error(`Couldn't get an answer (${res.status}). Try again.`);
      const data = (await res.json()) as FamilyResponse;
      setResult({ ...data, question: trimmed });
      setStatus({ kind: 'idle' });
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : "Couldn't get an answer." });
    }
  }

  const name = info?.first_name ?? 'this person';
  const busy = status.kind === 'asking';

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-7 px-5 pb-16 pt-6">
      <nav className="flex items-center justify-between">
        <Link href="/home" className="label transition-colors hover:text-ink">
          ← Hub
        </Link>
        <span className="rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted shadow-[inset_0_0_0_1px_var(--color-line)]">
          {info?.synthetic_label ?? 'Synthetic data'}
        </span>
      </nav>

      <header className="flex flex-col gap-3">
        <p className="label text-cyan-ink">Care · Family mode</p>
        <h1 className="text-[40px] font-light leading-[0.95] tracking-[-0.04em]">Ask how {name} would answer.</h1>
        <p className="text-[15px] text-muted">
          The twin answers only from {name}&apos;s own words, and shows which ones. If they don&apos;t cover it, it says so.
        </p>
      </header>

      {loadError && (
        <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {loadError}
        </p>
      )}
      {!info && !loadError && <p className="text-sm text-muted">Loading…</p>}

      {info && info.askers.length === 0 && (
        <p className="glass p-5 text-[15px]">
          Family mode is off. {name} hasn&apos;t named anyone who may use it.
        </p>
      )}

      {info && asker && (
        <section aria-labelledby="ask-heading" className="glass flex flex-col gap-4 p-5">
          <h2 id="ask-heading" className="sr-only">
            Ask a question
          </h2>

          {info.askers.length === 1 ? (
            <p className="flex flex-col gap-0.5">
              <span className="label">Asking</span>
              <span className="text-[17px] font-medium">{asker}</span>
            </p>
          ) : (
            <fieldset className="flex flex-col gap-2">
              <legend className="label mb-2">Who is asking</legend>
              <div className="flex flex-wrap gap-2">
                {info.askers.map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => setAsker(a)}
                    aria-pressed={a === asker}
                    className={`h-9 rounded-full px-4 text-sm transition-colors ${
                      a === asker ? 'bg-ink text-white' : 'bg-white/70 shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-white'
                    }`}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void ask(question);
            }}
          >
            <label htmlFor="family-question" className="label">
              Question for {name}
            </label>
            <textarea
              id="family-question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={3}
              maxLength={MAX_QUESTION}
              placeholder={speech.supported ? 'Type a question, or tap Speak…' : 'Type a question…'}
              className="w-full rounded-2xl bg-white/80 p-4 text-[16px] leading-relaxed shadow-[inset_0_0_0_1px_var(--color-line)] outline-none focus:shadow-[inset_0_0_0_2px_var(--color-cyan-ink)]"
            />
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={busy || question.trim().length === 0}
                className="inline-flex h-11 items-center gap-2 rounded-full bg-ink px-5 text-[15px] font-medium text-white transition-colors hover:bg-cyan-ink disabled:opacity-50"
              >
                Ask <span aria-hidden="true">→</span>
              </button>
              {speech.supported && (
                <button
                  type="button"
                  onClick={() => {
                    speech.reset();
                    speech.listen();
                  }}
                  disabled={busy || speech.listening}
                  className="inline-flex h-11 items-center gap-2 rounded-full bg-white/70 px-4 text-[15px] shadow-[inset_0_0_0_1px_var(--color-line)] transition-colors hover:bg-white disabled:opacity-60"
                >
                  <MicIcon />
                  {speech.listening ? 'Listening…' : 'Speak'}
                </button>
              )}
            </div>
          </form>

          {!result && !busy && (
            <div className="flex flex-col gap-2 border-t border-line pt-4">
              <span className="label">Try</span>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void ask(s)}
                    className="rounded-full bg-white/70 px-3 py-1.5 text-left text-sm shadow-[inset_0_0_0_1px_var(--color-line)] transition-colors hover:bg-white"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      <section aria-live="polite" className="flex flex-col gap-4">
        {busy && (
          <div className="glass flex items-center gap-3 p-5">
            <span aria-hidden="true" className="h-2.5 w-2.5 animate-ping rounded-full bg-cyan" />
            <span className="text-[15px]">Looking through {name}&apos;s words…</span>
          </div>
        )}

        {status.kind === 'error' && (
          <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {status.message}
          </p>
        )}

        {result && (
          <article className="glass flex flex-col gap-4 p-6" aria-label={`${name}'s answer`}>
            <header className="flex flex-col gap-1">
              <span className="label">{result.asker} asked</span>
              <span className="text-[15px] text-muted">{result.question}</span>
            </header>
            <p className="text-[21px] font-light leading-snug tracking-[-0.01em]">{result.answer}</p>

            {result.cited_entries.length > 0 && (
              <div className="flex flex-col gap-3 border-t border-line pt-4">
                <span className="label">
                  From {name}&apos;s own words · {result.cited_entries.length}
                </span>
                <ul className="flex flex-col gap-2">
                  {result.cited_entries.map((entry) => (
                    <li key={entry.id} className="rounded-2xl bg-white/70 p-4 shadow-[inset_0_0_0_1px_var(--color-line)]">
                      <span className="label text-[10px] text-cyan-ink">{KIND_TEXT[entry.kind]}</span>
                      <p className="mt-1 text-[15px] leading-relaxed">{entry.text}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                setResult(null);
                setQuestion('');
              }}
              className="label self-start text-cyan-ink hover:text-ink"
            >
              Ask another →
            </button>
          </article>
        )}
      </section>
    </main>
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
