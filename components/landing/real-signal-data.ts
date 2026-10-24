/**
 * Real-signal data for the landing page: one PhysioNet stress session, the
 * windows where heart rate rose above its baseline, and how those windows line
 * up with the protocol across all sessions.
 *
 * Pure and server-safe. The landing page builds this at render time and sends
 * only the chosen session to the browser. The detector mirrors the one the
 * wearable-insights spec asks Kiro to build in lib/wearable-insight.ts: a
 * trailing 60-second mean that must stay at least HR_RISE_BPM above the
 * Baseline phase mean for at least MIN_WINDOW_S.
 */

export const HR_RISE_BPM = 10;
export const MIN_WINDOW_S = 60;
const TRAILING_SAMPLES = 6;

const STRESS_TASKS = new Set([
  'Stroop',
  'TMCT',
  'Real Opinion',
  'Opposite Opinion',
  'Subtract',
]);

export type StressPhase = {
  phase: string;
  start_s: number;
  end_s: number;
  hr_mean_bpm: number;
  eda_mean_us: number;
  self_reported_stress: number;
};

export type StressSubject = {
  id: string;
  phases: StressPhase[];
  series: { step_s: number; hr_bpm: (number | null)[]; eda_us: (number | null)[] };
};

export type StressSample = { subjects: StressSubject[] };

export type SignalWindow = {
  start_s: number;
  end_s: number;
  peak_rise_bpm: number;
  phase: string;
};

export type RealSignal = {
  id: string;
  step_s: number;
  hr: (number | null)[];
  baselineHr: number;
  phases: Pick<StressPhase, 'phase' | 'start_s' | 'end_s' | 'self_reported_stress'>[];
  windows: SignalWindow[];
  summary: { sessions: number; windows: number; inTask: number };
};

/** Maximal runs where the trailing HR mean stays at least HR_RISE_BPM above baseline. */
export function detectStressWindows(
  hr: (number | null)[],
  step_s: number,
  baselineHr: number,
): Omit<SignalWindow, 'phase'>[] {
  const trailing = hr.map((_, i) => {
    const vals = hr
      .slice(Math.max(0, i - TRAILING_SAMPLES + 1), i + 1)
      .filter((v): v is number => v !== null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  });
  const limit = baselineHr + HR_RISE_BPM;
  const windows: Omit<SignalWindow, 'phase'>[] = [];
  let i = 0;
  while (i < trailing.length) {
    const v = trailing[i];
    if (v === null || v < limit) {
      i += 1;
      continue;
    }
    let j = i;
    let peak = v;
    while (j < trailing.length && trailing[j] !== null && (trailing[j] as number) >= limit) {
      peak = Math.max(peak, trailing[j] as number);
      j += 1;
    }
    if ((j - i) * step_s >= MIN_WINDOW_S) {
      windows.push({
        start_s: i * step_s,
        end_s: j * step_s,
        peak_rise_bpm: Math.round((peak - baselineHr) * 10) / 10,
      });
    }
    i = j;
  }
  return windows;
}

/** The protocol phase a window overlaps most, or "Transition" between phases. */
function dominantPhase(phases: StressPhase[], w: { start_s: number; end_s: number }): string {
  let best = 'Transition';
  let overlap = 0;
  for (const p of phases) {
    const o = Math.min(w.end_s, p.end_s) - Math.max(w.start_s, p.start_s);
    if (o > overlap) {
      overlap = o;
      best = p.phase;
    }
  }
  return best;
}

export function buildRealSignal(sample: StressSample, id: string): RealSignal {
  let windows = 0;
  let inTask = 0;
  for (const s of sample.subjects) {
    const found = detectStressWindows(s.series.hr_bpm, s.series.step_s, s.phases[0].hr_mean_bpm);
    windows += found.length;
    inTask += found.filter((w) => STRESS_TASKS.has(dominantPhase(s.phases, w))).length;
  }

  const subject = sample.subjects.find((s) => s.id === id);
  if (!subject) throw new Error(`Unknown PhysioNet session ${id}`);
  const baselineHr = subject.phases[0].hr_mean_bpm;

  return {
    id: subject.id,
    step_s: subject.series.step_s,
    hr: subject.series.hr_bpm,
    baselineHr,
    phases: subject.phases.map(({ phase, start_s, end_s, self_reported_stress }) => ({
      phase,
      start_s,
      end_s,
      self_reported_stress,
    })),
    windows: detectStressWindows(subject.series.hr_bpm, subject.series.step_s, baselineHr).map(
      (w) => ({ ...w, phase: dominantPhase(subject.phases, w) }),
    ),
    summary: { sessions: sample.subjects.length, windows, inTask },
  };
}
