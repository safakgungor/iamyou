'use client';

/**
 * App entry — "Try as Maya" (Req 1). Served at /app; the marketing landing lives at /.
 *
 * On tap the page:
 *  1. Signs the visitor in anonymously in the browser via
 *     `supabase.auth.signInAnonymously()` using the publishable key (Req 1.1).
 *  2. POSTs to `/api/demo/start`, which seeds Maya's synthetic data server-side
 *     with the service-role key (Req 1.2, 1.3).
 *  3. On a 200, navigates to `/home`. On any non-200 it shows an error and does
 *     NOT present a partial demo (Req 1.6).
 *
 * The page previews Maya's persona, so it carries the visible "Synthetic data"
 * label (Req 1.5). The service-role key is never referenced here — only the
 * public browser client is used (Req 1.4).
 *
 * Maya appears as the landing page's particle portrait; while the demo starts
 * she becomes her twin's sphere.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import TwinPortrait from '@/components/twin-portrait';
import { createSupabaseBrowserClient } from '@/lib/db/supabase-browser';

const FACTS = [
  { value: '40', label: 'Things she has said' },
  { value: '20', label: 'Daily questions' },
  { value: '5', label: 'Messages waiting' },
];

export default function AppEntryPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleTryAsMaya() {
    setLoading(true);
    setError(null);

    try {
      // 1. Anonymous sign-in in the browser (publishable key, no email) (Req 1.1).
      const supabase = createSupabaseBrowserClient();
      const { error: signInError } = await supabase.auth.signInAnonymously();
      if (signInError) {
        throw new Error(signInError.message);
      }

      // 2. Seed Maya's synthetic vault server-side (Req 1.2, 1.3).
      const res = await fetch('/api/demo/start', { method: 'POST' });

      // 3. Any non-200 means the demo is unavailable; never present a partial
      //    session (Req 1.6).
      if (!res.ok) {
        throw new Error('The demo is unavailable right now. Please try again.');
      }

      router.push('/home');
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'The demo is unavailable right now. Please try again.'
      );
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-8 pt-3">
      <header className="flex items-center justify-between">
        <span className="text-[21px] font-medium tracking-[-0.03em]">iamyou</span>
        <span className="rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted shadow-[inset_0_0_0_1px_var(--color-line)]">
          Synthetic data
        </span>
      </header>

      <div className="relative -mx-6 h-[38vh] max-h-[330px] min-h-[250px]">
        <TwinPortrait waking={loading} />
      </div>

      <section className="flex flex-1 flex-col">
        <p className="label text-cyan-ink">A digital twin, from age 18</p>
        <h1 className="mt-3 text-[46px] font-light leading-[0.92] tracking-[-0.045em]">Meet Maya.</h1>
        <p className="mt-4 text-[16px] leading-relaxed text-muted">
          She is 18, studies neuroscience, and is the one her family calls first. Her twin is learning to think like her.
        </p>

        <dl className="glass mt-6 grid grid-cols-3 divide-x divide-line px-2 py-4">
          {FACTS.map((f) => (
            <div key={f.label} className="flex flex-col items-center gap-1 px-2 text-center">
              <dt className="order-2 font-mono text-[9px] uppercase leading-snug tracking-[0.12em] text-muted">{f.label}</dt>
              <dd className="order-1 text-[26px] font-light leading-none tracking-[-0.03em]">{f.value}</dd>
            </div>
          ))}
        </dl>

        {error && (
          <p role="alert" className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="mt-auto flex flex-col gap-3 pt-6">
          <button
            type="button"
            onClick={handleTryAsMaya}
            disabled={loading}
            className="inline-flex h-14 items-center justify-center gap-2 rounded-full bg-ink text-[16px] font-medium text-white shadow-[0_14px_30px_-16px_rgb(24_33_46/0.7)] transition-colors hover:bg-cyan-ink disabled:opacity-70"
          >
            {loading ? (
              "Waking Maya's twin…"
            ) : (
              <>
                Try as Maya <span aria-hidden="true">→</span>
              </>
            )}
          </button>
          <p className="label text-center text-[10px]">No sign-up · Synthetic persona</p>
        </div>
      </section>
    </main>
  );
}
