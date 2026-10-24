'use client';

/**
 * Landing page — "Try as Maya" (Req 1).
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
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/db/supabase-browser';

/** The visible label shown on any screen presenting synthetic data (Req 1.5). */
function SyntheticLabel() {
  return (
    <span className="inline-block rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
      Synthetic data
    </span>
  );
}

export default function LandingPage() {
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
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-8 px-6 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">iamyou</h1>
        <p className="text-base text-gray-600">
          Your digital twin: a predict-and-correct check-in loop. Try it as Maya
          in one tap — no sign-up needed.
        </p>
      </header>

      <section className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-surface p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Meet Maya</h2>
          <SyntheticLabel />
        </div>
        <p className="text-sm text-gray-600">
          Maya Linden grew up in western Massachusetts, studied neuroscience, and
          is the person her family calls first. Her twin has learned from 40
          synthetic vault entries.
        </p>
      </section>

      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        onClick={handleTryAsMaya}
        disabled={loading}
        className="rounded-lg bg-accent px-6 py-3 text-base font-medium text-white disabled:opacity-50"
      >
        {loading ? 'Starting…' : 'Try as Maya'}
      </button>
    </main>
  );
}
