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
 * If a demo session already exists (an authenticated `GET /api/scores` probe returns
 * 200), the page offers "Continue as Maya" straight to `/home`, with "Start
 * fresh" running the sign-in and seed again.
 *
 * The page previews Maya's persona, so it carries the visible "Synthetic data"
 * label (Req 1.5). The service-role key is never referenced here — only the
 * public browser client is used (Req 1.4).
 *
 * Maya appears as the landing page's particle portrait; while the demo starts
 * she becomes her twin's sphere, then the page fades and `/home` (prefetched on
 * mount) takes over. A safe internal `?next=` path replaces `/home`, so the
 * landing page can deep-link into any screen.
 */

import { Suspense, useEffect, useRef, useState, type RefObject } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import TwinPortrait from '@/components/twin-portrait';
import { DataPill } from '@/components/flow/screen-header';
import { prefersReducedMotion, stagger } from '@/components/flow/motion';
import { createSupabaseBrowserClient } from '@/lib/db/supabase-browser';

const FACTS = [
  { value: '40', label: 'Things she has said' },
  { value: '20', label: 'Daily questions' },
  { value: '5', label: 'Messages waiting' },
];

type Phase = 'idle' | 'waking' | 'leaving' | 'error';
type Session = 'checking' | 'none' | 'existing';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Where to land after the demo starts: `?next=` when it is an internal path
 * (starts with one "/", no scheme, no backslash), otherwise `/home`.
 */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return '/home';
  try {
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin) return '/home';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/home';
  }
}

/**
 * Reads `?next=` into a ref and prefetches it. Kept in its own Suspense
 * boundary so the rest of the page still prerenders.
 */
function NextTarget({ target }: { target: RefObject<string> }) {
  const params = useSearchParams();
  const router = useRouter();
  useEffect(() => {
    target.current = safeNext(params.get('next'));
    router.prefetch(target.current);
  }, [params, router, target]);
  return null;
}

export default function AppEntryPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('idle');
  const [session, setSession] = useState<Session>('checking');
  const target = useRef('/home');

  // Warm up /home and look for an existing demo session.
  useEffect(() => {
    router.prefetch('/home');
    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    // The scores route reads a session id; any fresh one will do for a probe.
    fetch(`/api/scores?session_id=${crypto.randomUUID()}`, { signal: controller.signal, cache: 'no-store' })
      .then((res) => !cancelled && setSession(res.ok ? 'existing' : 'none'))
      .catch(() => !cancelled && setSession('none'))
      .finally(() => clearTimeout(timer));
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [router]);

  /** Fade the page out, then hand over to /home. */
  async function leave() {
    setPhase('leaving');
    await delay(prefersReducedMotion() ? 0 : 320);
    router.push(target.current);
  }

  async function handleTryAsMaya() {
    setPhase('waking');

    try {
      const wake = async () => {
        // 1. Anonymous sign-in in the browser (publishable key, no email) (Req 1.1).
        const supabase = createSupabaseBrowserClient();
        const { error: signInError } = await supabase.auth.signInAnonymously();
        if (signInError) throw new Error(signInError.message);

        // 2. Seed Maya's synthetic vault server-side (Req 1.2, 1.3).
        const res = await fetch('/api/demo/start', { method: 'POST' });

        // 3. Any non-200 means the demo is unavailable; never present a partial
        //    session (Req 1.6).
        if (!res.ok) throw new Error(`Demo start failed (${res.status}).`);
      };
      // Let the waking pulse read as a moment, even on a fast connection.
      await Promise.all([wake(), delay(prefersReducedMotion() ? 0 : 1200)]);
      await leave();
    } catch (err) {
      console.warn(err);
      setPhase('error');
    }
  }

  async function handleContinue() {
    setPhase('waking');
    // Top the session up to the current demo (idempotent upserts), so a session
    // opened before a newer seed still has Maya's full history.
    const refresh = fetch('/api/demo/start', { method: 'POST' }).catch(() => null);
    await Promise.all([refresh, delay(prefersReducedMotion() ? 0 : 700)]);
    await leave();
  }

  const busy = phase === 'waking' || phase === 'leaving';
  const resume = session === 'existing' && phase !== 'error';

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-8 pt-3">
      <Suspense fallback={null}>
        <NextTarget target={target} />
      </Suspense>
      <nav className="flex h-11 items-center justify-between">
        <span className="text-[21px] font-medium tracking-[-0.03em]">iamyou</span>
        <DataPill />
      </nav>

      <div className="relative -mx-6 h-[38vh] max-h-[330px] min-h-[250px]">
        <TwinPortrait waking={busy} />
      </div>

      <section
        className={`flex flex-1 flex-col transition-[opacity,transform] duration-300 ease-out motion-reduce:transition-none ${
          phase === 'leaving' ? 'translate-y-2 opacity-0' : ''
        }`}
      >
        <header className="flex flex-col gap-3">
          <p className="label rise text-cyan-ink">A digital twin, from age 18</p>
          <h1 className="rise text-[36px] font-light leading-[0.98] tracking-[-0.04em]" style={stagger(1)}>
            Meet Maya.
          </h1>
          <p className="rise text-[16px] leading-relaxed text-muted" style={stagger(2)}>
            She is 18, studies neuroscience, and is the one her family calls first. Her twin is learning to think like her.
          </p>
        </header>

        <dl className="glass rise mt-6 grid grid-cols-3 divide-x divide-line px-2 py-4" style={stagger(3)}>
          {FACTS.map((f) => (
            <div key={f.label} className="flex flex-col items-center gap-1 px-2 text-center">
              <dt className="order-2 font-mono text-[9px] uppercase leading-snug tracking-[0.12em] text-muted">{f.label}</dt>
              <dd className="order-1 text-[26px] font-light leading-none tracking-[-0.03em]">{f.value}</dd>
            </div>
          ))}
        </dl>

        {phase === 'error' && (
          <div role="alert" className="rise mt-4 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50/80 p-4">
            <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-red-600" />
            <p className="flex flex-col gap-0.5">
              <span className="text-[15px] font-medium text-red-800">Maya&apos;s twin didn&apos;t wake up.</span>
              <span className="text-sm text-red-700">Check your connection and try again.</span>
            </p>
          </div>
        )}

        <div className="rise mt-auto flex flex-col gap-1 pt-6" style={stagger(4)}>
          <button
            type="button"
            onClick={resume ? handleContinue : handleTryAsMaya}
            disabled={busy}
            aria-busy={busy}
            className="tap inline-flex h-14 items-center justify-center gap-2.5 rounded-full bg-ink text-[16px] font-medium text-white shadow-[0_14px_30px_-16px_rgb(24_33_46/0.7)] transition-colors hover:bg-cyan-ink disabled:bg-ink/90"
          >
            {busy ? (
              <>
                <span aria-hidden="true" className="h-2 w-2 animate-pulse rounded-full bg-cyan motion-reduce:animate-none" />
                Waking Maya&apos;s twin…
              </>
            ) : phase === 'error' ? (
              'Try again'
            ) : (
              <>
                {resume ? 'Continue as Maya' : 'Try as Maya'} <span aria-hidden="true">→</span>
              </>
            )}
          </button>

          {/* One fixed-height row under the button, so nothing shifts when the
              session check lands or the twin starts waking. */}
          <div className="flex h-11 items-center justify-center">
            {busy ? (
              <p className="label text-[10px]" aria-live="polite">
                Opening her synthetic vault
              </p>
            ) : resume ? (
              <button
                type="button"
                onClick={handleTryAsMaya}
                className="tap label inline-flex h-11 items-center rounded-full px-4 text-[10px] transition-colors hover:text-ink"
              >
                Start fresh as Maya
              </button>
            ) : (
              <p className="label text-[10px]">No sign-up</p>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
