/**
 * `app/real-signal/page.tsx` — iamyou Signal on real wristband data.
 *
 * One PhysioNet participant on two days: a stress protocol and a cycling
 * session. At the same heart rate, the model tells mental stress from exercise
 * by reading movement and skin signals against the person's own resting
 * baseline. Every probability is out of fold, so the model never trained on
 * this person. A server component: the charts are static SVG, no client JS.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import demo from '@/data/public/signal-demo.json';
import {
  buildWristDemo,
  type SignalClass,
  type SignalDemo,
  type WristSession,
  type WristWindow,
} from '@/lib/wrist-demo';

export const metadata: Metadata = { title: 'Same heart, two reasons · iamyou' };

const SOURCE = 'https://doi.org/10.13026/he0v-tf17';

const PHASE_LABEL: Record<string, string> = {
  Stroop: 'Stroop test',
  TMCT: 'Mental arithmetic',
  'Real Opinion': 'Speech',
  'Opposite Opinion': 'Speech',
  Subtract: 'Serial subtraction',
};

const READ: Record<SignalClass, { label: string; fill: string; chip: string }> = {
  rest: { label: 'Rest', fill: 'var(--color-muted)', chip: 'bg-ink/10 text-ink' },
  stress: { label: 'Stress', fill: 'var(--color-cyan-ink)', chip: 'bg-cyan-ink text-white' },
  exercise: { label: 'Exercise', fill: 'var(--color-cyan)', chip: 'bg-cyan text-ink' },
};

// The evaluation scores only labelled tasks, rests and cycling stages; the
// baseline (the person's reference), instructions, warm-up and cool-down are not.
const SCORED = new Set(['stress', 'rest', 'exercise']);

// One heart-rate scale for both days, so the same rate sits at the same height.
const Y_MIN = 50;
const Y_MAX = 135;
const W = 340;
const PLOT_TOP = 8;
const PLOT_H = 100;
const STRIP_Y = 116;
const H = 132;

const pct = (x: number) => `${Math.round(x * 100)}%`;
const yOf = (hr: number) => PLOT_TOP + (1 - (hr - Y_MIN) / (Y_MAX - Y_MIN)) * PLOT_H;

export default function RealSignalPage() {
  const d = buildWristDemo(demo as SignalDemo);
  const rise = Math.round(d.still.hr - d.baselineHr);
  const ratio = Math.round(d.moving.movement / d.still.movement);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-8 px-5 pb-16 pt-6">
      <nav className="flex items-center justify-between">
        <Link href="/health" className="label transition-colors hover:text-ink">
          ← Health
        </Link>
        <a
          href={SOURCE}
          target="_blank"
          rel="noreferrer"
          className="rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted shadow-[inset_0_0_0_1px_var(--color-line)] transition-colors hover:text-ink"
        >
          Open research data · PhysioNet ↗
        </a>
      </nav>

      <header>
        <p className="label text-cyan-ink">iamyou Signal · wrist</p>
        <h1 className="mt-3 text-[36px] font-light leading-[0.95] tracking-[-0.04em]">
          <span className="block">Same heart.</span>
          <span className="block">Two reasons.</span>
        </h1>
        <p className="mt-4 text-[15px] leading-snug text-muted">
          One person&apos;s wristband on two days. Our model never saw this person, and still tells
          the days apart.
        </p>
      </header>

      <section aria-label="Two moments at the same heart rate" className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Moment day="Day 1" what={PHASE_LABEL[d.still.phase?.name ?? ''] ?? 'Stress task'} w={d.still} />
          <Moment day="Day 2" what={`Cycling, ${d.moving.phase?.name ?? ''}`} w={d.moving} />
        </div>
        <p className="text-[14px] leading-snug text-muted">
          Both at {Math.round(d.still.hr)} bpm. On the bike the wrist moved {ratio}× more. The model
          reads each moment against this person&apos;s own resting heart rate,{' '}
          {Math.round(d.baselineHr)} bpm.
        </p>
      </section>

      <SessionCard
        title="Day 1 · stress tasks"
        session={d.stress}
        shadeKind="stress"
        shadeLabel="Shaded: stress tasks"
        baselineHr={d.baselineHr}
        mark={d.still}
        stat={`Read as stress in ${pct(d.stressFound)} of task time, and in ${pct(d.restFalseAlarm)} of the rests.`}
      />
      <SessionCard
        title="Day 2 · cycling"
        session={d.aerobic}
        shadeKind="exercise"
        shadeLabel="Shaded: cycling stages"
        baselineHr={d.baselineHr}
        mark={d.moving}
        stat={`Read as exercise in ${pct(d.exerciseFound)} of cycling time.`}
      />

      <section className="glass p-5">
        <p className="label text-cyan-ink">What the twin does with it</p>
        <p className="mt-3 rounded-2xl bg-white/70 px-4 py-3 text-[16px] leading-snug shadow-[inset_0_0_0_1px_var(--color-line)]">
          Your heart rate rose {rise} bpm while you were barely moving. What was going on?
        </p>
        <p className="mt-3 text-[14px] leading-snug text-muted">
          It asks instead of guessing, and remembers the answer.
        </p>
      </section>

      <section className="glass p-5">
        <p className="label">The model</p>
        <dl className="mt-3 divide-y divide-line text-[14px]">
          <Row k="Trained on" v="33 people, PhysioNet" />
          <Row k="Tested" v="Each person left out of training" />
          <Row k="Balanced accuracy" v="0.77" />
          <Row k="Exercise recognised" v="94%" />
          <Row k="Own baseline vs population" v="+0.05" />
        </dl>
        <p className="mt-4 text-[12px] leading-snug text-muted">
          A wellness estimate, not a medical device. {d.subject} is the clearest of the 33 people;
          the figures above cover all of them.
        </p>
      </section>

      <footer className="text-[11px] leading-snug text-muted">
        Source:{' '}
        <a href={SOURCE} target="_blank" rel="noreferrer" className="underline underline-offset-2">
          PhysioNet, Wearable Device Dataset from Induced Stress and Structured Exercise Sessions
          v1.0.1
        </a>{' '}
        (ODC-By), Empatica E4 wristband.
      </footer>
    </main>
  );
}

function Moment({ day, what, w }: { day: string; what: string; w: WristWindow }) {
  return (
    <div className="glass p-4">
      <p className="label">{day}</p>
      <p className="mt-1 text-[13px] leading-tight">{what}</p>
      <p className="mt-3 text-[34px] font-light leading-none tracking-[-0.03em]">
        {Math.round(w.hr)}
        <span className="ml-1 text-[13px] tracking-normal text-muted">bpm</span>
      </p>
      <p className="mt-2 text-[12px] text-muted">
        Wrist {w.movement < 0.01 ? 'still' : 'moving'} · {w.movement.toFixed(3)} g
      </p>
      <p
        className={`mt-3 inline-flex rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] ${READ[w.read].chip}`}
      >
        {READ[w.read].label} {pct(w.confidence)}
      </p>
    </div>
  );
}

function SessionCard({
  title,
  session,
  shadeKind,
  shadeLabel,
  baselineHr,
  mark,
  stat,
}: {
  title: string;
  session: WristSession;
  shadeKind: string;
  shadeLabel: string;
  baselineHr: number;
  mark: WristWindow;
  stat: string;
}) {
  const x = (t: number) => (t / session.duration_s) * W;
  const step = session.windows.length > 1 ? session.windows[1].t - session.windows[0].t : 10;
  const line = session.windows
    .map((w, i) => `${i ? 'L' : 'M'}${x(w.t).toFixed(1)} ${yOf(w.hr).toFixed(1)}`)
    .join(' ');

  return (
    <section className="glass p-5">
      <div className="flex items-baseline justify-between">
        <p className="label text-ink">{title}</p>
        <p className="label">{Math.round(session.duration_s / 60)} min</p>
      </div>

      <div className="relative mt-4">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-[132px] w-full" aria-hidden>
          {session.phases
            .filter((p) => p.kind === shadeKind)
            .map((p) => (
              <rect
                key={p.start_s}
                x={x(p.start_s)}
                y={PLOT_TOP}
                width={x(p.end_s) - x(p.start_s)}
                height={PLOT_H}
                fill="var(--color-cyan-ink)"
                opacity={0.07}
              />
            ))}
          <line
            x1={0}
            x2={W}
            y1={yOf(baselineHr)}
            y2={yOf(baselineHr)}
            stroke="var(--color-muted)"
            strokeDasharray="3 4"
            strokeWidth={1}
            opacity={0.6}
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={line}
            fill="none"
            stroke="var(--color-ink)"
            strokeWidth={1.6}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          {session.windows.map((w) => (
            <rect
              key={w.t}
              x={x(w.t - step / 2)}
              y={STRIP_Y}
              width={x(step) + 0.4}
              height={12}
              fill={READ[w.read].fill}
              opacity={!SCORED.has(w.phase?.kind ?? '') ? 0.12 : w.read === 'rest' ? 0.25 : 0.35 + 0.65 * w.confidence}
            />
          ))}
        </svg>
        <span
          aria-hidden
          className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-cyan-ink shadow-[0_0_0_4px_rgb(11_134_168/0.18)]"
          style={{ left: `${(mark.t / session.duration_s) * 100}%`, top: `${yOf(mark.hr)}px` }}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
        {(['stress', 'exercise', 'rest'] as const).map((c) => (
          <span key={c} className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm" style={{ background: READ[c].fill, opacity: c === 'rest' ? 0.4 : 1 }} />
            {READ[c].label}
          </span>
        ))}
        <span>· {shadeLabel}</span>
        <span>· Pale: not scored</span>
        <span>· Dashed: resting {Math.round(baselineHr)} bpm</span>
      </div>
      <p className="mt-3 text-[14px] leading-snug">{stat}</p>
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="text-muted">{k}</dt>
      <dd className="text-right">{v}</dd>
    </div>
  );
}
