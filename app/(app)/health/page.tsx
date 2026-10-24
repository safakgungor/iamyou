'use client';

/**
 * The Health tab: where the baseline stands this week, the six weekly measures
 * at a glance against the person's own normal, and the two deeper screens
 * (the timeline and the wrist signal). Data comes from GET /api/timeline,
 * which already applies the right-not-to-know gate, and GET /api/county.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import IndexCard from '@/components/index-card';
import type { CountyResponse, TimelineResponse } from '@/lib/api-schemas';

type OptedIn = Extract<TimelineResponse, { opted_in: true }>;
type Feature = keyof OptedIn['baseline'];

const FEATURES: { key: Feature; label: string; format: (v: number) => string }[] = [
  { key: 'vocabulary_diversity', label: 'Vocabulary range', format: (v) => v.toFixed(2) },
  { key: 'mean_sentence_length', label: 'Sentence length', format: (v) => `${v.toFixed(1)} words` },
  { key: 'filler_rate', label: 'Filler words', format: (v) => `${v.toFixed(1)} / 100` },
  { key: 'sleep_hours', label: 'Sleep', format: (v) => `${v.toFixed(1)} h` },
  { key: 'active_minutes', label: 'Active minutes', format: (v) => `${Math.round(v)} min` },
  { key: 'twin_accuracy', label: 'Twin accuracy', format: (v) => `${Math.round(v * 100)}%` },
];

const WHO_HEARS: Record<string, string> = { tell_me: 'You', doctor_only: 'Only your doctor', record_only: 'No one' };

const LABEL_NAME: Record<Feature, string> = Object.fromEntries(FEATURES.map((f) => [f.key, f.label])) as Record<
  Feature,
  string
>;

/** Mean of each of `n` equal slices, skipping missing weeks. */
function downsample(values: (number | null)[], n: number): (number | null)[] {
  const size = Math.max(1, Math.ceil(values.length / n));
  const out: (number | null)[] = [];
  for (let i = 0; i < values.length; i += size) {
    const slice = values.slice(i, i + size).filter((v): v is number => v !== null);
    out.push(slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : null);
  }
  return out;
}

const style = (i: number) => ({ '--i': i }) as React.CSSProperties;

export default function HealthPage() {
  const [data, setData] = useState<TimelineResponse | null>(null);
  const [county, setCounty] = useState<CountyResponse | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'signed-out' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/timeline');
        if (res.status === 401) {
          if (!cancelled) setStatus('signed-out');
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        let body = (await res.json()) as TimelineResponse;
        // An older demo session has no weekly rows yet: seed it once and read again.
        if (body.opted_in && body.rows.length === 0 && (await fetch('/api/demo/start', { method: 'POST' })).ok) {
          const again = await fetch('/api/timeline');
          if (again.ok) body = (await again.json()) as TimelineResponse;
        }
        if (!cancelled) {
          setData(body);
          setStatus('ready');
        }
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    fetch('/api/county')
      .then((r) => (r.ok ? (r.json() as Promise<CountyResponse>) : { available: false as const }))
      .then((c) => !cancelled && setCounty(c))
      .catch(() => !cancelled && setCounty({ available: false }));
    return () => {
      cancelled = true;
    };
  }, []);

  const timeline = data && data.opted_in ? data : null;
  const rows = timeline?.rows ?? [];
  const last = rows.at(-1);
  const years = rows.length > 1 ? (Date.parse(last!.week_start) - Date.parse(rows[0].week_start)) / (365.25 * 86_400_000) : 0;
  const age = 18 + Math.floor(years);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 px-5 pb-16 pt-6">
      <header className="rise mb-2">
        <div className="flex items-center justify-between">
          <p className="label text-cyan-ink">Health layer</p>
          {timeline && (
            <span className="rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted shadow-[inset_0_0_0_1px_var(--color-line)]">
              Synthetic data
            </span>
          )}
        </div>
        <h1 className="mt-3 text-[36px] font-light leading-[0.95] tracking-[-0.04em]">
          <span className="block">A baseline,</span>
          <span className="block">while you&apos;re well.</span>
        </h1>
        <p className="mt-4 text-[15px] leading-snug text-muted">
          Your speech, sleep and activity, week by week, measured against your own normal. You
          decide who hears about a change.
        </p>
      </header>

      {status === 'loading' && (
        <div className="glass h-40 animate-pulse" aria-label="Loading your baseline" />
      )}

      {status === 'signed-out' && (
        <Link href="/app?next=/health" className="glass tap rise flex items-center justify-between gap-4 p-5">
          <span className="text-[15px]">Start as Maya to see her 22 years.</span>
          <span aria-hidden="true">→</span>
        </Link>
      )}

      {status === 'error' && (
        <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          The baseline is unavailable right now. Try again in a moment.
        </p>
      )}

      {data && !data.opted_in && (
        <Link href="/timeline" className="glass tap rise flex items-center justify-between gap-4 p-5">
          <span className="flex flex-col gap-1">
            <span className="label text-cyan-ink">Health layer is off</span>
            <span className="text-[15px]">Nothing is being recorded. Turn it on from your timeline.</span>
          </span>
          <span aria-hidden="true">→</span>
        </Link>
      )}

      {timeline && last && (
        <>
          <section className="glass rise flex flex-col gap-4 p-5" style={style(1)} aria-label="This week">
            <div className="flex items-baseline justify-between gap-3">
              <p className="label">This week · age {age}</p>
              <p className="label">{last.week_start}</p>
            </div>
            <p className="flex items-baseline gap-2">
              <span className="text-[44px] font-light leading-none tracking-[-0.04em]">
                {rows.length.toLocaleString('en-US')}
              </span>
              <span className="text-sm text-muted">weeks recorded since 18</span>
            </p>
            {timeline.signal ? (
              <Link
                href="/timeline"
                className="tap flex items-start gap-3 rounded-2xl bg-white/70 p-4 shadow-[inset_0_0_0_1px_var(--color-line)]"
              >
                <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-cyan-ink shadow-[0_0_0_4px_rgb(11_134_168/0.15)]" />
                <span className="flex flex-col gap-1">
                  <span className="text-[15px] font-medium">Change noticed · week of {timeline.signal.first_week}</span>
                  <span className="text-[13px] leading-snug text-muted">
                    {timeline.signal.features.map((f) => LABEL_NAME[f]).join(' and ')} drifted from your normal. See what
                    changed →
                  </span>
                </span>
              </Link>
            ) : (
              <p className="text-[15px] leading-snug">Everything is within your own normal.</p>
            )}
            <p className="flex items-center justify-between border-t border-line pt-3 text-[13px]">
              <span className="text-muted">Who hears about a change</span>
              <Link href="/timeline" className="font-medium text-cyan-ink">
                {WHO_HEARS[timeline.rtk_setting ?? 'record_only']} →
              </Link>
            </p>
          </section>

          <section className="rise grid grid-cols-2 gap-3" style={style(2)} aria-label="Your six measures">
            {FEATURES.map((f) => {
              const values = rows.map((r) => r[f.key]);
              const latest = [...values].reverse().find((v): v is number => v !== null) ?? null;
              const base = timeline.baseline[f.key];
              return (
                <Link key={f.key} href="/timeline" className="glass tap flex flex-col gap-1 p-3.5">
                  <span className="text-[12px] text-muted">{f.label}</span>
                  <span className="text-[17px] font-medium tracking-[-0.01em]">
                    {latest === null ? '—' : f.format(latest)}
                  </span>
                  <Spark values={downsample(values, 48)} baseline={base} />
                  {base && <span className="font-mono text-[10px] text-muted">normal {f.format(base.mean)}</span>}
                </Link>
              );
            })}
          </section>
        </>
      )}

      <IndexCard
        href="/timeline"
        kicker="Your timeline"
        title="22 years against your own baseline"
        text="Play it from 18 to 40, week by week."
        i={3}
      />
      <IndexCard
        href="/real-signal"
        kicker="Wrist signal · research data"
        title="Same heart, two reasons"
        text="At 101 bpm: stress when still, exercise when moving."
        i={4}
      />

      {county?.available && (
        <p className="rise px-1 text-[13px] leading-snug text-muted" style={style(5)}>
          For context: {county.card.prevalence}% of adults in {county.card.county} County slept under 7 hours a night in{' '}
          {county.card.year} (CDC PLACES).
        </p>
      )}
    </main>
  );
}

function Spark({ values, baseline }: { values: (number | null)[]; baseline: { mean: number; sd: number } | null }) {
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length < 2) return <span className="h-8" />;
  let lo = Math.min(...nums);
  let hi = Math.max(...nums);
  if (baseline) {
    lo = Math.min(lo, baseline.mean - 2 * baseline.sd);
    hi = Math.max(hi, baseline.mean + 2 * baseline.sd);
  }
  const span = hi - lo || 1;
  const x = (i: number) => (i / (values.length - 1)) * 100;
  const y = (v: number) => 30 - ((v - lo) / span) * 28;
  const d = values
    .map((v, i) => (v === null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`))
    .filter(Boolean)
    .join(' ');
  return (
    <svg viewBox="0 0 100 32" preserveAspectRatio="none" className="h-8 w-full" aria-hidden="true">
      {baseline && (
        <rect
          x="0"
          width="100"
          y={y(baseline.mean + 2 * baseline.sd)}
          height={Math.max(0.5, y(baseline.mean - 2 * baseline.sd) - y(baseline.mean + 2 * baseline.sd))}
          fill="var(--color-cyan)"
          opacity="0.14"
        />
      )}
      <polyline
        points={d}
        fill="none"
        stroke="var(--color-cyan-ink)"
        strokeWidth="1.4"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
      />
    </svg>
  );
}
