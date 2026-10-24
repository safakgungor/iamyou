'use client';

/**
 * `app/home/page.tsx` — the hub (Req 8.1)
 *
 * The twin at the top, then the day's check-in, how well the twin knows the
 * user (the weekly trend from `GET /api/scores`), the second self, and the
 * one-tap "Delete my vault" control that calls `DELETE /api/vault`, behind an
 * inline confirm so a stray tap in a demo does not wipe Maya's vault.
 *
 * The scores response shape matches `ScoresResponseSchema`:
 * `{ session_score: number, weekly_trend: Record<string, number> }`. The hub
 * opens its own session, so it shows the weekly trend, which covers every
 * answer, rather than the always-empty session score.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import TwinPortrait from '@/components/twin-portrait';

type Scores = {
  session_score: number;
  weekly_trend: Record<string, number>;
};

export default function HomePage() {
  const [scores, setScores] = useState<Scores | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState(false);

  // One session id per visit to the hub. The scores route reads the
  // `session_id` query param to compute the session score.
  const [sessionId] = useState(() =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : String(Date.now())
  );

  useEffect(() => {
    let cancelled = false;

    async function loadScores() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/scores?session_id=${encodeURIComponent(sessionId)}`
        );
        if (!res.ok) {
          throw new Error(`Could not load scores (${res.status}).`);
        }
        const data: Scores = await res.json();
        if (!cancelled) {
          setScores(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load scores.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadScores();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch('/api/vault', { method: 'DELETE' });
      if (!res.ok) {
        throw new Error(`Could not delete your vault (${res.status}).`);
      }
      setDeleted(true);
      setScores({ session_score: 0, weekly_trend: {} });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not delete your vault.'
      );
    } finally {
      setDeleting(false);
      setConfirming(false);
    }
  }, []);

  const weeks = scores
    ? Object.entries(scores.weekly_trend).sort(([a], [b]) => a.localeCompare(b)).slice(-8)
    : [];
  const latest = weeks.length ? weeks[weeks.length - 1][1] : null;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-5 px-5 pb-12 pt-3">
      <header className="flex items-center justify-between">
        <span className="text-[21px] font-medium tracking-[-0.03em]">iamyou</span>
        <span className="rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted shadow-[inset_0_0_0_1px_var(--color-line)]">
          Synthetic data
        </span>
      </header>

      <section className="relative -mx-5 flex h-44 items-end justify-center">
        <div className="absolute inset-0">
          <TwinPortrait shape="twin" count={8000} pointSize={10} />
        </div>
      </section>

      <div className="rise flex flex-col gap-2" style={{ '--i': 1 } as React.CSSProperties}>
        <p className="label text-cyan-ink">Maya&apos;s twin</p>
        <h1 className="text-[38px] font-light leading-[0.95] tracking-[-0.04em]">Good to see you, Maya.</h1>
      </div>

      <Link
        href="/check-in"
        className="tap rise group flex items-center justify-between gap-4 rounded-[22px] bg-ink p-5 text-white shadow-[0_30px_60px_-30px_rgb(24_33_46/0.6)]"
        style={{ '--i': 2 } as React.CSSProperties}
      >
        <span className="flex flex-col gap-1">
          <span className="label text-cyan">Today&apos;s check-in</span>
          <span className="text-[19px] font-medium tracking-[-0.01em]">One question. The twin answers first.</span>
          <span className="text-sm text-white/60">About 30 seconds, by voice or text.</span>
        </span>
        <span
          aria-hidden="true"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-cyan text-ink transition-colors group-hover:bg-white"
        >
          →
        </span>
      </Link>

      <div className="rise grid grid-cols-2 gap-3" style={{ '--i': 3 } as React.CSSProperties}>
        <Link href="/assistant" className="glass tap flex flex-col gap-1 p-4">
          <span className="label text-cyan-ink">Second self</span>
          <span className="text-[16px] font-medium">Your inbox</span>
          <span className="text-[13px] leading-snug text-muted">Replies drafted in your voice.</span>
        </Link>
        <Link href="/mind" className="glass tap flex flex-col gap-1 p-4">
          <span className="label text-cyan-ink">Mind tree</span>
          <span className="text-[16px] font-medium">What it knows</span>
          <span className="text-[13px] leading-snug text-muted">Everything it has learned about you.</span>
        </Link>
      </div>

      <section aria-labelledby="knows-heading" className="glass rise flex flex-col gap-4 p-5" style={{ '--i': 4 } as React.CSSProperties}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="knows-heading" className="label">
            How well it knows you
          </h2>
          {weeks.length > 0 && <span className="label text-[10px]">{weeks.length} wk</span>}
        </div>

        {loading && <p className="text-sm text-muted">Loading…</p>}
        {error && (
          <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        )}

        {!loading && !error && (
          latest === null ? (
            <p className="text-[15px] text-muted">
              No check-ins yet. After your first one, this shows how close the twin&apos;s guesses come.
            </p>
          ) : (
            <>
              <p className="flex items-baseline gap-2">
                <span className="text-[52px] font-light leading-none tracking-[-0.04em]">{Math.round(latest * 100)}%</span>
                <span className="text-sm text-muted">match this week</span>
              </p>
              <div className="flex h-16 items-end gap-1.5" aria-label="Weekly match">
                {weeks.map(([week, value]) => (
                  <div key={week} className="flex h-full flex-1 flex-col justify-end">
                    <span
                      className="w-full rounded-t-md bg-gradient-to-t from-cyan-ink to-cyan"
                      style={{ height: `${Math.max(6, value * 100)}%` }}
                      title={`${week}: ${Math.round(value * 100)}%`}
                    />
                  </div>
                ))}
              </div>
              <p className="label text-[10px]">Weeks {weeks[0][0].slice(-3)} to {weeks[weeks.length - 1][0].slice(-3)}</p>
            </>
          )
        )}
      </section>

      <section aria-labelledby="data-heading" className="rise mt-2 flex flex-col gap-3 px-1" style={{ '--i': 5 } as React.CSSProperties}>
        <h2 id="data-heading" className="label">
          Your data
        </h2>
        {deleted ? (
          <p className="text-[15px]">
            Your vault is empty.{' '}
            <Link href="/app" className="text-cyan-ink underline-offset-4 hover:underline">
              Start again as Maya
            </Link>
          </p>
        ) : confirming ? (
          <div className="flex flex-col gap-3 rounded-2xl border border-red-200 bg-red-50/70 p-4">
            <p className="text-sm text-red-800">Delete everything in your vault? This cannot be undone.</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="h-10 rounded-full bg-red-700 px-4 text-sm font-medium text-white disabled:opacity-60"
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={deleting}
                className="h-10 rounded-full px-4 text-sm shadow-[inset_0_0_0_1px_var(--color-line)]"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <p className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
            Everything the twin knows lives in your vault.
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="label text-red-700/80 hover:text-red-700"
            >
              Delete my vault
            </button>
          </p>
        )}
      </section>
    </main>
  );
}
