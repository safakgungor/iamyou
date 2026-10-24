/**
 * Sanity check: run the TypeScript port with the all-subjects model on every
 * demo window and compare per phase with the stored out-of-fold probabilities.
 *
 *   node --experimental-strip-types check-demo.ts [signal-model.json] [signal-demo.json]
 *
 * The all-subjects model has seen this person, so it should be at least as
 * confident as the out-of-fold numbers the demo shows. Exits 1 if output is
 * not a probability vector, if exercise is not recognised during cycling, or
 * if stress tasks do not score above the seated rests.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SIGNAL_CLASSES, WINDOW_FEATURES, classifyWindow, parseSignalModel } from '../ts/signal-model.ts';
import type { SignalBaseline, SignalClass, SignalProbabilities, SignalWindow } from '../ts/signal-model.ts';

interface Phase { name: string; kind: string; start_s: number; end_s: number }
interface Session {
  protocol: string;
  phases: Phase[];
  t: number[];
  features: Record<string, number[]>;
  oof: Record<SignalClass, number[]>;
}
interface Demo { subject: string; baseline: SignalBaseline; sessions: Record<string, Session> }

const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
const model = parseSignalModel(JSON.parse(readFileSync(process.argv[2] ?? here('../../../data/public/signal-model.json'), 'utf8')));
const demo = JSON.parse(readFileSync(process.argv[3] ?? here('../../../data/public/signal-demo.json'), 'utf8')) as Demo;

const failures: string[] = [];
const fmt = (p: SignalProbabilities): string => SIGNAL_CLASSES.map((c) => p[c].toFixed(2)).join(' ');
const mean = (rows: SignalProbabilities[]): SignalProbabilities => {
  const out: SignalProbabilities = { rest: 0, stress: 0, exercise: 0 };
  for (const r of rows) for (const c of SIGNAL_CLASSES) out[c] += r[c] / Math.max(rows.length, 1);
  return out;
};
const stressScore = (p: SignalProbabilities): number => p.stress / (p.rest + p.stress + 1e-12);

console.log(`subject ${demo.subject}; columns: rest stress exercise (all-subjects TS | out-of-fold stored)`);
for (const [key, s] of Object.entries(demo.sessions)) {
  const live: SignalProbabilities[] = [];
  const oof: SignalProbabilities[] = [];
  s.t.forEach((_, i) => {
    const w = {} as SignalWindow;
    for (const f of WINDOW_FEATURES) w[f] = s.features[f]?.[i] ?? Number.NaN;
    const p = classifyWindow(model, w, demo.baseline);
    const sum = p.rest + p.stress + p.exercise;
    if (!Number.isFinite(sum) || Math.abs(sum - 1) > 1e-12) failures.push(`${key}[${i}]: sum ${sum}`);
    live.push(p);
    oof.push({ rest: s.oof.rest[i] ?? 0, stress: s.oof.stress[i] ?? 0, exercise: s.oof.exercise[i] ?? 0 });
  });
  console.log(`\n${s.protocol}: ${s.t.length} windows`);
  const byKind: Record<string, { live: SignalProbabilities[]; oof: SignalProbabilities[] }> = {};
  for (const ph of s.phases) {
    // windows lying entirely inside the phase
    const idx = s.t.flatMap((t, i) => (t >= ph.start_s && t + 30 <= ph.end_s ? [i] : []));
    const l = idx.flatMap((i) => live[i] ?? []);
    const o = idx.flatMap((i) => oof[i] ?? []);
    const bucket = (byKind[ph.kind] ??= { live: [], oof: [] });
    bucket.live.push(...l);
    bucket.oof.push(...o);
    if (idx.length > 0) {
      console.log(`  ${ph.name.padEnd(17)} ${String(idx.length).padStart(3)} win  ${fmt(mean(l))} | ${fmt(mean(o))}`);
    } else {
      console.log(`  ${ph.name.padEnd(17)}   - (shorter than one window)`);
    }
  }
  const ex = byKind['exercise'];
  if (ex) {
    const l = mean(ex.live).exercise;
    const o = mean(ex.oof).exercise;
    console.log(`  cycling: mean P(exercise) ${l.toFixed(3)} live, ${o.toFixed(3)} out-of-fold`);
    if (!(l > 0.8)) failures.push(`${key}: cycling P(exercise) ${l.toFixed(3)} <= 0.8`);
  }
  const st = byKind['stress'];
  const re = byKind['rest'];
  if (st && re && key === 'stress') {
    const ls = mean(st.live.map((p) => ({ ...p, stress: stressScore(p) }))).stress;
    const lr = mean(re.live.map((p) => ({ ...p, stress: stressScore(p) }))).stress;
    const os = mean(st.oof.map((p) => ({ ...p, stress: stressScore(p) }))).stress;
    const or = mean(re.oof.map((p) => ({ ...p, stress: stressScore(p) }))).stress;
    console.log(`  stress-vs-rest score: tasks ${ls.toFixed(3)} vs rests ${lr.toFixed(3)} live; `
      + `${os.toFixed(3)} vs ${or.toFixed(3)} out-of-fold`);
    if (!(ls > lr)) failures.push('stress tasks do not score above rests (live)');
    if (!(os > or)) failures.push('stress tasks do not score above rests (out-of-fold)');
  }
}

if (failures.length > 0) {
  console.error(`\nDEMO CHECK FAILED (${failures.length}):`);
  for (const f of failures.slice(0, 20)) console.error(`  ${f}`);
  process.exit(1);
}
console.log('\nOK: sensible output on every demo window');
