'use client';

/**
 * `app/timeline/page.tsx` — the health layer's timeline (health-baseline Req 7, 8, 9).
 *
 * Six weekly feature charts from age 18 to 40, each with the person's own
 * baseline band (mean ± 2 sd) and gaps where a week has no value. An age
 * scrubber highlights the same week on every chart. A change signal shows as a
 * marker plus exactly the User_Facing_Signal_Text, and only when the server
 * sent it and gate() says the user should see it. The right-not-to-know
 * control writes the caller's own profile under RLS; doctor_only and
 * record_only clear the marker at once, tell_me re-requests the timeline.
 * Opted-out users see only a control to turn the health layer on (Req 9.5).
 * The county card adds CDC PLACES context without judging the user's sleep.
 */

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/db/supabase-browser';
import { gate } from '@/lib/signal';
import type { CountyResponse, TimelineResponse } from '@/lib/api-schemas';

const SIGNAL_TEXT =
  "I've noticed some changes over the past few weeks. You might want to talk to your doctor about it.";

type Rtk = 'tell_me' | 'doctor_only' | 'record_only';
type OptedIn = Extract<TimelineResponse, { opted_in: true }>;
type Feature = keyof OptedIn['baseline'];

const FEATURES: { key: Feature; label: string; format: (v: number) => string }[] = [
  { key: 'vocabulary_diversity', label: 'Vocabulary range', format: (v) => v.toFixed(2) },
  { key: 'mean_sentence_length', label: 'Sentence length', format: (v) => `${v.toFixed(1)} words` },
  { key: 'filler_rate', label: 'Filler words', format: (v) => `${v.toFixed(1)} per 100` },
  { key: 'sleep_hours', label: 'Sleep', format: (v) => `${v.toFixed(1)} h` },
  { key: 'active_minutes', label: 'Active minutes', format: (v) => `${Math.round(v)} min` },
  { key: 'twin_accuracy', label: 'Twin accuracy', format: (v) => `${Math.round(v * 100)}%` },
];

const RTK_OPTIONS: { value: Rtk; label: string; note: string }[] = [
  { value: 'tell_me', label: 'Me', note: 'You see a change when it is noticed.' },
  { value: 'doctor_only', label: 'My doctor', note: 'A change goes only into the summary for your clinician.' },
  { value: 'record_only', label: 'No one', note: 'Changes are recorded and never shown.' },
];

const DAY = 86_400_000;
const toUtc = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

export default function TimelinePage() {
  const [data, setData] = useState<TimelineResponse | null>(null);
  const [county, setCounty] = useState<CountyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [age, setAge] = useState(40);
  const [rtk, setRtk] = useState<Rtk | null>(null);
  const [hidden, setHidden] = useState(false);
  const [saving, setSaving] = useState(false);
  const [playing, setPlaying] = useState(false);
  const playTimer = useRef<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/timeline');
      if (!res.ok) throw new Error(`The timeline is unavailable right now (${res.status}).`);
      const body = (await res.json()) as TimelineResponse;
      setData(body);
      if (body.opted_in) setRtk(body.rtk_setting);
      setHidden(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The timeline is unavailable right now.');
    }
  }, []);

  useEffect(() => {
    void load();
    fetch('/api/county')
      .then((r) => (r.ok ? (r.json() as Promise<CountyResponse>) : { available: false as const }))
      .then(setCounty)
      .catch(() => setCounty({ available: false }));
  }, [load]);

  const timeline = data && data.opted_in ? data : null;

  // The week whose 7-day span contains start + (age − 18) years (Req 7.9).
  const scrubIndex = useMemo(() => {
    if (!timeline?.rows.length) return -1;
    const start = new Date(toUtc(timeline.rows[0].week_start));
    const target = Date.UTC(start.getUTCFullYear() + (age - 18), start.getUTCMonth(), start.getUTCDate());
    let i = timeline.rows.findIndex((r) => target >= toUtc(r.week_start) && target < toUtc(r.week_start) + 7 * DAY);
    if (i < 0) i = target < toUtc(timeline.rows[0].week_start) ? 0 : timeline.rows.length - 1;
    return i;
  }, [timeline, age]);

  // Server already gated the signal; the screen gates again before drawing (Req 5.6, 7.10).
  const signal = timeline?.signal ?? null;
  const visible =
    !!signal &&
    !hidden &&
    gate({ features: signal.features, firstWeek: signal.first_week, detectedWeek: signal.detected_week }, rtk).showToUser;
  const markerIndex = visible && timeline ? timeline.rows.findIndex((r) => r.week_start === signal!.first_week) : -1;

  async function changeRtk(value: Rtk) {
    if (saving || value === rtk) return;
    setSaving(true);
    setError(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error('Start the demo first.');
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ rtk_setting: value })
        .eq('user_id', auth.user.id);
      if (updateError) throw new Error(updateError.message);
      setRtk(value);
      if (value === 'tell_me') {
        await load(); // Req 7.13: re-request; draw only what the server sends
      } else {
        setHidden(true); // Req 7.13: clear the marker at once, no reload
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the setting.');
    } finally {
      setSaving(false);
    }
  }

  async function turnOn() {
    setSaving(true);
    setError(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error('Start the demo first.');
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ health_layer_opt_in: true })
        .eq('user_id', auth.user.id);
      if (updateError) throw new Error(updateError.message);
      await load(); // Req 9.6: only after the update succeeds
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not turn on the health layer.');
    } finally {
      setSaving(false);
    }
  }

  // "Play 18 → 40" walks the scrubber for a demo.
  function play() {
    if (playing) return;
    setPlaying(true);
    let a = 18;
    setAge(a);
    playTimer.current = window.setInterval(() => {
      a += 1;
      setAge(a);
      if (a >= 40 && playTimer.current) {
        window.clearInterval(playTimer.current);
        setPlaying(false);
      }
    }, 260);
  }
  useEffect(() => () => {
    if (playTimer.current) window.clearInterval(playTimer.current);
  }, []);

  const scrubWeek = timeline && scrubIndex >= 0 ? timeline.rows[scrubIndex] : null;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-5 px-5 pb-10 pt-3">
      <header className="flex items-center justify-between">
        <Link href="/health" className="label transition-colors hover:text-ink">
          ← Health
        </Link>
        <span className="rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted shadow-[inset_0_0_0_1px_var(--color-line)]">
          Synthetic data
        </span>
      </header>

      <div className="flex flex-col gap-2 pt-2">
        <p className="label text-cyan-ink">Health layer</p>
        <h1 className="text-[36px] font-light leading-[0.95] tracking-[-0.04em]">A baseline, while you&apos;re well.</h1>
        <p className="text-[15px] text-muted">Every week from 18 to 40, measured against your own normal.</p>
      </div>

      {error && (
        <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {!data && !error && <p className="text-sm text-muted">Loading twenty-two years…</p>}

      {data && !data.opted_in && (
        <section className="glass flex flex-col gap-3 p-5">
          <p className="label">Health layer · off</p>
          <p className="text-[16px]">Your twin is not recording a health baseline.</p>
          <button
            type="button"
            onClick={turnOn}
            disabled={saving}
            className="inline-flex h-12 items-center justify-center rounded-full bg-ink text-[15px] font-medium text-white transition-colors hover:bg-cyan-ink disabled:opacity-50"
          >
            {saving ? 'Turning on…' : 'Turn on the health layer'}
          </button>
        </section>
      )}

      {timeline && (
        <>
          {visible && (
            <section role="status" className="glass flex flex-col gap-2 border-l-4 border-l-cyan-ink p-5">
              <span className="label text-cyan-ink">Noticed · week of {signal!.first_week}</span>
              <p className="text-[16px] leading-relaxed">{SIGNAL_TEXT}</p>
            </section>
          )}

          <section className="glass flex flex-col gap-3 p-5">
            <div className="flex items-baseline justify-between">
              <span className="text-[34px] font-light leading-none tracking-[-0.04em]">Age {age}</span>
              <span className="label text-[10px]">{scrubWeek ? `Week of ${scrubWeek.week_start}` : ''}</span>
            </div>
            <input
              type="range"
              min={18}
              max={40}
              step={1}
              value={age}
              onChange={(e) => setAge(Number(e.target.value))}
              aria-label="Age"
              className="w-full accent-cyan-ink"
            />
            <div className="flex items-center justify-between">
              <span className="label text-[10px]">18</span>
              <button type="button" onClick={play} disabled={playing} className="label text-cyan-ink hover:text-ink disabled:opacity-50">
                {playing ? 'Playing…' : 'Play 18 → 40'}
              </button>
              <span className="label text-[10px]">40</span>
            </div>
          </section>

          <section className="flex flex-col gap-3">
            {FEATURES.map((f) => (
              <FeatureChart
                key={f.key}
                label={f.label}
                format={f.format}
                values={timeline.rows.map((r) => r[f.key])}
                baseline={timeline.baseline[f.key]}
                scrubIndex={scrubIndex}
                markerIndex={visible && signal!.features.includes(f.key) ? markerIndex : -1}
              />
            ))}
          </section>

          <section className="glass flex flex-col gap-3 p-5" aria-labelledby="rtk-heading">
            <h2 id="rtk-heading" className="label">
              Who hears about a change
            </h2>
            <div role="radiogroup" aria-labelledby="rtk-heading" className="grid grid-cols-3 gap-1 rounded-full bg-ink/5 p-1">
              {RTK_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={rtk === o.value}
                  onClick={() => changeRtk(o.value)}
                  disabled={saving}
                  className={`h-10 rounded-full text-[14px] transition-colors ${
                    rtk === o.value ? 'bg-ink text-white' : 'text-ink hover:bg-white/70'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <p className="text-sm text-muted">{RTK_OPTIONS.find((o) => o.value === rtk)?.note ?? 'Choose who hears about a change.'}</p>
          </section>
        </>
      )}

      {county && (
        <section className="glass flex flex-col gap-2 p-5">
          <span className="label">County context · CDC PLACES</span>
          {county.available ? (
            <>
              <p className="flex items-baseline gap-2">
                <span className="text-[40px] font-light leading-none tracking-[-0.04em]">{`${county.card.prevalence}%`}</span>
                <span className="text-sm text-muted">range {county.card.low}–{county.card.high}%</span>
              </p>
              <p className="text-[15px] leading-relaxed">
                of adults in {county.card.county} County slept under 7 hours a night in {county.card.year}.
              </p>
              <p className="label text-[10px]">County-level population estimate</p>
            </>
          ) : (
            <p className="text-sm text-muted">County context unavailable.</p>
          )}
        </section>
      )}
    </main>
  );
}

const CW = 350;
const CH = 72;

function FeatureChart({
  label,
  format,
  values,
  baseline,
  scrubIndex,
  markerIndex,
}: {
  label: string;
  format: (v: number) => string;
  values: (number | null)[];
  baseline: { mean: number; sd: number } | null;
  scrubIndex: number;
  markerIndex: number;
}) {
  const { path, band, x, y } = useMemo(() => {
    const nums = values.filter((v): v is number => v !== null);
    let lo = Math.min(...nums);
    let hi = Math.max(...nums);
    if (baseline) {
      lo = Math.min(lo, baseline.mean - 2 * baseline.sd);
      hi = Math.max(hi, baseline.mean + 2 * baseline.sd);
    }
    const pad = (hi - lo) * 0.08 || 1;
    lo -= pad;
    hi += pad;
    const x = (i: number) => (i / Math.max(1, values.length - 1)) * CW;
    const y = (v: number) => CH - ((v - lo) / (hi - lo)) * CH;
    // A null week breaks the line: a gap, never 0 (Req 7.7).
    let d = '';
    let pen = false;
    values.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    const band = baseline
      ? { top: y(baseline.mean + 2 * baseline.sd), bottom: y(baseline.mean - 2 * baseline.sd) }
      : null;
    return { path: d, band, x, y };
  }, [values, baseline]);

  const current = scrubIndex >= 0 ? values[scrubIndex] : null;
  const marker = markerIndex >= 0 ? values[markerIndex] : null;

  return (
    <div className="glass flex flex-col gap-2 px-4 py-3">
      <div className="flex items-baseline justify-between">
        <span className="text-[14px] font-medium">{label}</span>
        <span className="font-mono text-[12px] tabular-nums text-muted">{current === null || current === undefined ? '—' : format(current)}</span>
      </div>
      <svg viewBox={`0 0 ${CW} ${CH}`} className="h-16 w-full overflow-visible" role="img" aria-label={`${label}, weekly from age 18 to 40`}>
        {band && <rect x={0} y={band.top} width={CW} height={Math.max(1, band.bottom - band.top)} className="fill-cyan/15" />}
        <path d={path} fill="none" stroke="var(--color-cyan-ink)" strokeWidth={1} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {scrubIndex >= 0 && (
          <line x1={x(scrubIndex)} x2={x(scrubIndex)} y1={0} y2={CH} stroke="var(--color-ink)" strokeOpacity={0.5} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        )}
        {marker !== null && marker !== undefined && (
          <g>
            <circle cx={x(markerIndex)} cy={y(marker)} r={6} className="fill-cyan/30" />
            <circle cx={x(markerIndex)} cy={y(marker)} r={3} fill="var(--color-ink)" />
          </g>
        )}
      </svg>
    </div>
  );
}
