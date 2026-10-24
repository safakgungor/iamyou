'use client';

/**
 * A real PhysioNet heart-rate recording, drawn as the visitor scrolls. The
 * flagged window is where a wearable notices "something happened"; the twin's
 * question and the protocol's ground truth show why asking matters.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import type { RealSignal } from './real-signal-data';

gsap.registerPlugin(ScrollTrigger, useGSAP);

// Wide charts on desktop; a taller frame on phones so the line keeps its shape.
const FRAME = {
  wide: { W: 1000, H: 300, FS: 12, PAD: { top: 28, right: 16, bottom: 44, left: 16 } },
  narrow: { W: 600, H: 420, FS: 18, PAD: { top: 40, right: 8, bottom: 64, left: 8 } },
};

const PHASE_LABEL: Record<string, string> = {
  Baseline: 'Baseline',
  Stroop: 'Stroop',
  'First Rest': 'Rest',
  TMCT: 'Math',
  'Second Rest': 'Rest',
  'Real Opinion': 'Speech',
  'Opposite Opinion': 'Speech',
  Subtract: 'Count',
};

const PHASE_STORY: Record<string, string> = {
  Stroop: 'a Stroop color-word test',
  TMCT: 'mental arithmetic under time pressure',
  'Real Opinion': 'a short speech',
  'Opposite Opinion': 'a short speech',
  Subtract: 'counting backwards aloud',
};

export default function RealSignalChart({ signal }: { signal: RealSignal }) {
  const root = useRef<HTMLDivElement>(null);
  const [revealed, setRevealed] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const { W, H, FS, PAD } = FRAME[narrow ? 'narrow' : 'wide'];

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 899px)');
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  const { path, x, y, end } = useMemo(() => {
    const vals = signal.hr.filter((v): v is number => v !== null);
    const lo = Math.min(...vals, signal.baselineHr) - 6;
    const hi = Math.max(...vals) + 6;
    const end = (signal.hr.length - 1) * signal.step_s;
    const x = (s: number) => PAD.left + (s / end) * (W - PAD.left - PAD.right);
    const y = (bpm: number) => PAD.top + (1 - (bpm - lo) / (hi - lo)) * (H - PAD.top - PAD.bottom);
    let d = '';
    signal.hr.forEach((v, i) => {
      if (v === null) return;
      d += `${d ? 'L' : 'M'}${x(i * signal.step_s).toFixed(1)},${y(v).toFixed(1)}`;
    });
    return { path: d, x, y, end };
  }, [signal, W, H, PAD]);

  const first = signal.windows[0];
  const second = signal.windows[1];
  const phaseOf = (name: string) => signal.phases.find((p) => p.phase === name);
  const baseline = signal.phases[0].self_reported_stress;
  const minutes = first ? Math.round((first.end_s - first.start_s) / 60) : 0;

  useGSAP(
    () => {
      const line = root.current?.querySelector<SVGPathElement>('[data-signal-line]');
      if (!line) return;
      const len = line.getTotalLength();
      const mm = gsap.matchMedia();
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.set(line, { strokeDasharray: len, strokeDashoffset: len });
        const tl = gsap.timeline({
          scrollTrigger: { trigger: root.current, start: 'top 75%', end: 'bottom 60%', scrub: 1 },
        });
        tl.to(line, { strokeDashoffset: 0, ease: 'none', duration: 1 }, 0);
        signal.windows.forEach((w, i) => {
          tl.from(`[data-signal-window="${i}"]`, { opacity: 0, duration: 0.08 }, w.end_s / end);
        });
        tl.from('[data-signal-ask]', { opacity: 0, y: 16, duration: 0.1 }, first ? first.end_s / end : 0.5);
      });
      return () => mm.revert();
    },
    { scope: root, dependencies: [signal, narrow], revertOnUpdate: true },
  );

  return (
    <div ref={root} className="lx-signal lx-glass">
      <div className="lx-signal__head">
        <span className="lx-signal__legend">
          <span className="lx-label">Real signal · session {signal.id}</span>
          <span className="lx-label">
            <i className="lx-swatch lx-swatch--base" aria-hidden="true" /> Baseline {signal.baselineHr} bpm
          </span>
          <span className="lx-label">
            <i className="lx-swatch lx-swatch--rise" aria-hidden="true" /> +10 bpm for a minute or more
          </span>
        </span>
        <a
          className="lx-label lx-signal__source"
          href="https://doi.org/10.13026/he0v-tf17"
          target="_blank"
          rel="noreferrer"
        >
          Open research data · PhysioNet ↗
        </a>
      </div>

      <svg
        className="lx-signal__chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Heart rate over ${Math.round(end / 60)} minutes. ${signal.windows.length} windows rose at least 10 bpm above the baseline of ${signal.baselineHr} bpm.`}
      >
        {signal.phases.map((p, i) => (
          <g key={`${p.phase}-${i}`}>
            {p.phase in PHASE_STORY && (
              <rect x={x(p.start_s)} y={PAD.top} width={x(p.end_s) - x(p.start_s)} height={H - PAD.top - PAD.bottom} className="lx-signal__task" />
            )}
            <text x={(x(p.start_s) + x(p.end_s)) / 2} y={H - FS * 1.4} fontSize={FS} className="lx-signal__phase" textAnchor="middle">
              {(PHASE_LABEL[p.phase] ?? p.phase).length * FS * 0.62 <= x(p.end_s) - x(p.start_s) + FS * 1.5 ? PHASE_LABEL[p.phase] ?? p.phase : '·'}
            </text>
          </g>
        ))}

        {signal.windows.map((w, i) => (
          <g key={w.start_s} data-signal-window={i}>
            <rect x={x(w.start_s)} y={PAD.top} width={x(w.end_s) - x(w.start_s)} height={H - PAD.top - PAD.bottom} className="lx-signal__window" />
            <text x={x(w.start_s) + FS * 0.6} y={PAD.top + FS * 1.4} fontSize={FS} className="lx-signal__peak">
              +{w.peak_rise_bpm} bpm
            </text>
          </g>
        ))}

        <line x1={PAD.left} x2={W - PAD.right} y1={y(signal.baselineHr)} y2={y(signal.baselineHr)} className="lx-signal__base" />
        <path d={path} className="lx-signal__line" data-signal-line />
      </svg>

      {first && (
        <div className="lx-signal__ask" data-signal-ask>
          <div className="lx-bubble">
            <span className="lx-label">Twin</span>
            <p>
              Your heart rate rose {Math.round(first.peak_rise_bpm)} bpm for about {minutes} minutes. What was going on?
            </p>
          </div>

          <button type="button" className="lx-btn lx-btn--glass" aria-expanded={revealed} onClick={() => setRevealed(true)}>
            What really happened
          </button>

          <div className={`lx-signal__truth ${revealed ? 'is-open' : ''}`} aria-live="polite">
            {revealed && (
              <p>
                <strong>{PHASE_STORY[first.phase] ? `During ${PHASE_STORY[first.phase]}.` : 'Between two tasks.'}</strong>{' '}
                They rated their stress {phaseOf(first.phase)?.self_reported_stress ?? '–'}/10, against {baseline}/10 at rest.
                {second && PHASE_STORY[second.phase] && (
                  <>
                    {' '}
                    The second rise came with {PHASE_STORY[second.phase]}: {phaseOf(second.phase)?.self_reported_stress ?? '–'}/10.
                  </>
                )}
              </p>
            )}
          </div>
        </div>
      )}

      <p className="lx-signal__honest">
        Across {signal.summary.sessions} real sessions, {signal.summary.inTask} of {signal.summary.windows} spikes fell during a
        stress task. A wearable sees the spike, not the reason. That&apos;s why the twin asks.
      </p>
    </div>
  );
}
