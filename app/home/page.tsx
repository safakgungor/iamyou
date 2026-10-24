'use client';

/**
 * `app/home/page.tsx` — the hub (Req 8.1)
 *
 * A minimal client page that:
 *   - links to start a check-in (`/check-in`),
 *   - shows the session score and weekly trend by calling
 *     `GET /api/scores` on mount (Req 8.1), and
 *   - offers a one-tap "Delete my vault" control that calls
 *     `DELETE /api/vault`.
 *
 * Styling uses the shared Tailwind visual language (task 19.6): surface cards
 * on the app canvas, a slate accent for the primary action, and red reserved
 * for errors and the destructive delete control. The scores response shape
 * matches `ScoresResponseSchema`:
 * `{ session_score: number, weekly_trend: Record<string, number> }`.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

type Scores = {
  session_score: number;
  weekly_trend: Record<string, number>;
};

export default function HomePage() {
  const [scores, setScores] = useState<Scores | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
    const confirmed = window.confirm(
      'Delete your entire vault? This removes all of your stored data and cannot be undone.'
    );
    if (!confirmed) {
      return;
    }

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
    }
  }, []);

  const weeklyEntries = scores
    ? Object.entries(scores.weekly_trend).sort(([a], [b]) => a.localeCompare(b))
    : [];

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-8 px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Your hub</h1>

      <Link
        href="/check-in"
        className="rounded-lg bg-[--color-accent] px-6 py-3 text-center text-base font-medium text-white"
      >
        Start a check-in
      </Link>

      <section
        aria-labelledby="scores-heading"
        className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-[--color-surface] p-4"
      >
        <h2 id="scores-heading" className="text-lg font-medium">
          Your scores
        </h2>

        {loading && (
          <p className="text-sm text-[--color-muted]">Loading your scores…</p>
        )}
        {error && (
          <p
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          >
            {error}
          </p>
        )}

        {!loading && !error && scores && (
          <>
            <p className="flex items-baseline justify-between">
              <strong className="font-medium text-[--color-muted]">
                Session score:
              </strong>{' '}
              <span className="text-2xl font-semibold tabular-nums">
                {scores.session_score.toFixed(2)}
              </span>
            </p>

            <h3 className="text-xs font-medium uppercase tracking-wide text-[--color-muted]">
              Weekly trend
            </h3>
            {weeklyEntries.length === 0 ? (
              <p className="text-sm text-[--color-muted]">No weekly data yet.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {weeklyEntries.map(([week, value]) => (
                  <li
                    key={week}
                    className="flex items-baseline justify-between border-b border-gray-100 py-1 text-sm last:border-b-0"
                  >
                    <span className="text-[--color-muted]">{week}</span>
                    <span className="tabular-nums">{value.toFixed(2)}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <section
        aria-labelledby="danger-heading"
        className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-[--color-surface] p-4"
      >
        <h2 id="danger-heading" className="text-lg font-medium">
          Your data
        </h2>
        {deleted ? (
          <p className="text-sm text-[--color-muted]">
            Your vault has been deleted.
          </p>
        ) : (
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="self-start rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            {deleting ? 'Deleting…' : 'Delete my vault'}
          </button>
        )}
      </section>
    </main>
  );
}
