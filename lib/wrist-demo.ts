/**
 * Shapes `data/public/signal-demo.json` for the real-signal screen.
 *
 * One PhysioNet participant (S10) wore the same wristband on a stress-protocol
 * day and a cycling day. The probabilities are out of fold: they come from a
 * model trained on the other 32 people, never on this one. Pure: no I/O, no
 * mutation of the input.
 */

export type SignalClass = 'rest' | 'stress' | 'exercise';

type Phase = { name: string; kind: string; start_s: number; end_s: number };

type Session = {
  protocol: string;
  duration_s: number;
  phases: Phase[];
  t: number[];
  features: Record<string, number[]>;
  oof: Record<SignalClass, number[]>;
};

export type SignalDemo = {
  subject: string;
  window_s: number;
  baseline: { hr_mean: number };
  sessions: { stress: Session; aerobic: Session };
};

export type WristWindow = {
  /** Window centre, seconds from the session origin. */
  t: number;
  hr: number;
  /** Wrist movement: standard deviation of acceleration magnitude, in g. */
  movement: number;
  read: SignalClass;
  confidence: number;
  phase: Phase | null;
};

export type WristSession = {
  duration_s: number;
  phases: Phase[];
  windows: WristWindow[];
};

export type WristDemo = {
  subject: string;
  baselineHr: number;
  stress: WristSession;
  aerobic: WristSession;
  /** The highest-heart-rate window read as stress during a stress task. */
  still: WristWindow;
  /** The cycling window read as exercise whose heart rate is closest to `still`. */
  moving: WristWindow;
  /** Share of stress-task windows read as stress. */
  stressFound: number;
  /** Share of seated-rest windows read as stress. */
  restFalseAlarm: number;
  /** Share of cycling windows read as exercise. */
  exerciseFound: number;
};

const CLASSES: SignalClass[] = ['rest', 'stress', 'exercise'];

function session(s: Session, windowS: number): WristSession {
  const windows = s.t.map((start, i) => {
    const t = start + windowS / 2;
    const probs = CLASSES.map((c) => s.oof[c][i]);
    const best = probs.indexOf(Math.max(...probs));
    return {
      t,
      hr: s.features.hr_mean[i],
      movement: s.features.acc_std[i],
      read: CLASSES[best],
      confidence: probs[best],
      phase: s.phases.find((p) => p.start_s <= t && t < p.end_s) ?? null,
    };
  });
  return { duration_s: s.duration_s, phases: s.phases, windows };
}

function share(windows: WristWindow[], read: SignalClass): number {
  return windows.length ? windows.filter((w) => w.read === read).length / windows.length : 0;
}

export function buildWristDemo(demo: SignalDemo): WristDemo {
  const stress = session(demo.sessions.stress, demo.window_s);
  const aerobic = session(demo.sessions.aerobic, demo.window_s);

  const tasks = stress.windows.filter((w) => w.phase?.kind === 'stress');
  const rests = stress.windows.filter((w) => w.phase?.kind === 'rest');
  const cycling = aerobic.windows.filter((w) => w.phase?.kind === 'exercise');

  const still = tasks
    .filter((w) => w.read === 'stress')
    .reduce((a, b) => (b.hr > a.hr ? b : a));
  const moving = cycling
    .filter((w) => w.read === 'exercise')
    .reduce((a, b) => (Math.abs(b.hr - still.hr) < Math.abs(a.hr - still.hr) ? b : a));

  return {
    subject: demo.subject,
    baselineHr: demo.baseline.hr_mean,
    stress,
    aerobic,
    still,
    moving,
    stressFound: share(tasks, 'stress'),
    restFalseAlarm: share(rests, 'stress'),
    exerciseFound: share(cycling, 'exercise'),
  };
}
