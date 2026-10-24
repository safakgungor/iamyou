/**
 * Parity check: the TypeScript port against scikit-learn on real windows.
 *
 *   node --experimental-strip-types check.ts [signal-model.json] [test-vectors.json]
 *
 * Defaults: data/public/signal-model.json and ./test-vectors.json next to this file.
 * Exits with code 1 if any probability differs from sklearn by more than 1e-9,
 * or if shifting hr_mean and temp_mean of window and baseline together changes
 * the output by more than 1e-9.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  SIGNAL_CLASSES,
  classifyWindow,
  parseSignalModel,
  personalFeatures,
  predict,
  snapFeatures,
} from './signal-model.ts';
import type { SignalBaseline, SignalProbabilities, SignalWindow } from './signal-model.ts';

interface TestVector {
  id: string;
  label: string;
  window: SignalWindow;
  baseline: SignalBaseline;
  features: number[];
  expected: SignalProbabilities;
}

const TOL = 1e-9;
const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
const modelPath = process.argv[2] ?? here('../../../data/public/signal-model.json');
const vectorsPath = process.argv[3] ?? here('./test-vectors.json');

const model = parseSignalModel(JSON.parse(readFileSync(modelPath, 'utf8')));
const { vectors } = JSON.parse(readFileSync(vectorsPath, 'utf8')) as { vectors: TestVector[] };

const failures: string[] = [];
let maxProbDiff = 0;
let maxFeatureDiff = 0;
let maxShiftDiff = 0;
let labelHits = 0;
const SHIFTS = [7.5, -12.25, 100, 0.1];

const diff = (a: SignalProbabilities, b: SignalProbabilities): number =>
  Math.max(...SIGNAL_CLASSES.map((c) => Math.abs(a[c] - b[c])));

for (const v of vectors) {
  const x = personalFeatures(v.window, v.baseline, model.eda_eps);
  snapFeatures(x, model.input_snap_scale).forEach((xi, j) => {
    maxFeatureDiff = Math.max(maxFeatureDiff, Math.abs(xi - (v.features[j] ?? Number.NaN)));
  });

  const p = predict(model, x);
  const d = diff(p, v.expected);
  maxProbDiff = Math.max(maxProbDiff, d);
  if (!(d <= TOL)) failures.push(`${v.id}: |p - sklearn| = ${d.toExponential(3)}`);

  const c = classifyWindow(model, v.window, v.baseline);
  if (diff(c, p) !== 0) failures.push(`${v.id}: classifyWindow differs from predict`);
  const sum = SIGNAL_CLASSES.reduce((s, k) => s + p[k], 0);
  if (Math.abs(sum - 1) > 1e-12) failures.push(`${v.id}: probabilities sum to ${sum}`);
  if (c.label === v.label) labelHits++;

  for (const s of SHIFTS) {
    const w: SignalWindow = { ...v.window, hr_mean: v.window.hr_mean + s, temp_mean: v.window.temp_mean + s };
    const b: SignalBaseline = { ...v.baseline, hr_mean: v.baseline.hr_mean + s, temp_mean: v.baseline.temp_mean + s };
    const ds = diff(classifyWindow(model, w, b), c);
    maxShiftDiff = Math.max(maxShiftDiff, ds);
    if (!(ds <= TOL)) failures.push(`${v.id}: shift ${s} changes output by ${ds.toExponential(3)}`);
  }
}

console.log(`model ${model.name} ${model.version}: ${model.trees.length} iterations, ${model.trees.length * model.classes.length} trees`);
console.log(`vectors: ${vectors.length}  (labels matched by argmax: ${labelHits}/${vectors.length})`);
console.log(`max |p_ts - p_sklearn|        = ${maxProbDiff.toExponential(3)}  (tolerance ${TOL})`);
console.log(`max |features_ts - features_py| = ${maxFeatureDiff.toExponential(3)}  (snapped inputs)`);
console.log(`max shift change (hr, temp +c) = ${maxShiftDiff.toExponential(3)}  shifts ${SHIFTS.join(', ')}`);

if (vectors.length === 0) failures.push('no test vectors');
if (maxFeatureDiff !== 0) failures.push(`snapped features differ from Python by ${maxFeatureDiff}`);
if (failures.length > 0) {
  console.error(`\nPARITY CHECK FAILED (${failures.length}):`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log('OK: TypeScript output matches sklearn within 1e-9 and is shift-invariant');
