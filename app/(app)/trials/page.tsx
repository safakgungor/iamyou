'use client';

/**
 * `app/trials/page.tsx` — the trial finder (care-outputs Req 5–8).
 *
 * Lists studies recruiting in Massachusetts for the family condition, from
 * `GET /api/trials`. The server does every fetch: live from ClinicalTrials.gov,
 * then its one-hour cache, then the saved Massachusetts slice (Req 5.8). Each
 * trial shows its title, conditions, plain-language phase (never the raw
 * value), cities and a study link when it has an id (Req 7.8, 8.5, 8.6, 8.8).
 * The not-a-recommendation note is always shown (Req 8.7), and an empty list
 * shows the no-match text with the registry search (Req 6.5, 8.9).
 *
 * The trials are public registry data, so this screen carries a source label
 * rather than the synthetic one.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { TrialsResponse } from '@/lib/api-schemas';
import { NOT_A_RECOMMENDATION_TEXT, studyUrl } from '@/lib/trials';

type Origin = Extract<TrialsResponse, { status: 'ok' }>['origin'];

const ORIGIN_TEXT: Record<Origin, string> = {
  live: 'Live from ClinicalTrials.gov',
  cache: 'From ClinicalTrials.gov, checked in the last hour',
  stale_cache: 'Registry unreachable. Showing the last live list.',
  saved_ma_slice: 'Registry unreachable. Showing the saved list from October 18, 2026.',
};

export default function TrialsPage() {
  const [data, setData] = useState<TrialsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/trials');
        if (res.status === 401) throw new Error('Start the demo first: open the app and tap Try as Maya.');
        if (!res.ok) throw new Error(`The trial list is unavailable right now (${res.status}).`);
        const body = (await res.json()) as TrialsResponse;
        if (!cancelled) setData(body);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'The trial list is unavailable right now.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-7 px-5 pb-16 pt-6">
      <nav className="flex items-center justify-between">
        <Link href="/home" className="label transition-colors hover:text-ink">
          ← Hub
        </Link>
        <a
          href="https://clinicaltrials.gov"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted shadow-[inset_0_0_0_1px_var(--color-line)] transition-colors hover:text-ink"
        >
          Public data · ClinicalTrials.gov
        </a>
      </nav>

      <header className="flex flex-col gap-3">
        <p className="label text-cyan-ink">Care · Trials</p>
        <h1 className="text-[40px] font-light leading-[0.95] tracking-[-0.04em]">Studies recruiting in Massachusetts.</h1>
        <p className="text-[15px] text-muted">For the condition in your family, straight from the public registry.</p>
        <p className="flex items-center gap-2 text-[15px] text-ink">
          <span aria-hidden="true" className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-cyan shadow-[0_0_0_4px_rgb(54_209_240/0.2)]" />
          {NOT_A_RECOMMENDATION_TEXT}
        </p>
      </header>

      <section aria-labelledby="trials-heading" aria-live="polite" className="flex flex-col gap-3">
        <h2 id="trials-heading" className="label">
          Recruiting now{data?.status === 'ok' ? ` · ${data.trials.length}` : ''}
        </h2>

        {!data && !error && (
          <div className="glass flex items-center gap-3 p-5">
            <span aria-hidden="true" className="h-2.5 w-2.5 animate-ping rounded-full bg-cyan" />
            <span className="text-[15px]">Checking the registry…</span>
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </p>
        )}

        {data?.status === 'no_family_condition' && (
          <p className="glass p-5 text-[15px]">
            Your profile names no family condition, so there is nothing to search for.
          </p>
        )}

        {data?.status === 'no_matches' && (
          <div className="glass flex flex-col gap-3 p-5">
            <p className="text-[15px]">{data.message}</p>
            <a
              href={data.search_url}
              target="_blank"
              rel="noopener noreferrer"
              className="label text-cyan-ink transition-colors hover:text-ink"
            >
              Search ClinicalTrials.gov →
            </a>
          </div>
        )}

        {data?.status === 'ok' && (
          <>
            <p className="label text-[10px]">{ORIGIN_TEXT[data.origin]}</p>
            <ul className="flex flex-col gap-3">
              {data.trials.map((trial, index) => (
                <TrialCard key={`${trial.nctId}-${index}`} trial={trial} />
              ))}
            </ul>
            <a
              href={data.search_url}
              target="_blank"
              rel="noopener noreferrer"
              className="label mt-1 px-1 text-cyan-ink transition-colors hover:text-ink"
            >
              See the full search on ClinicalTrials.gov →
            </a>
          </>
        )}
      </section>
    </main>
  );
}

function TrialCard({ trial }: { trial: TrialsResponse['trials'][number] }) {
  const url = studyUrl(trial.nctId);
  return (
    <li className="glass flex flex-col gap-3 p-5">
      <h3 className="text-[17px] font-medium leading-snug tracking-[-0.01em]">{trial.title || 'Untitled study'}</h3>
      <p className="flex items-start gap-2 text-sm text-cyan-ink">
        <span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-cyan" />
        <span>
          <span className="sr-only">Phase: </span>
          {trial.phaseLabel}
        </span>
      </p>
      {trial.conditions.length > 0 && (
        <p className="text-sm text-muted">
          <span className="sr-only">Conditions: </span>
          {trial.conditions.join(' · ')}
        </p>
      )}
      <p className="flex items-start gap-1.5 text-sm">
        <PinIcon />
        <span>
          <span className="sr-only">Sites: </span>
          {trial.cities.join(', ')}
        </span>
      </p>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between gap-3 border-t border-line pt-3 text-sm text-ink transition-colors hover:text-cyan-ink"
        >
          <span className="font-mono text-[12px] tracking-[0.04em] text-muted">{trial.nctId}</span>
          <span>
            View the study <span aria-hidden="true">→</span>
          </span>
        </a>
      )}
    </li>
  );
}

function PinIcon() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="mt-[3px] shrink-0 text-muted">
      <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </svg>
  );
}
