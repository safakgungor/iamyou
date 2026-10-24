/**
 * iamyou Signal: rest, stress or exercise from a 30-second wrist window,
 * judged against the person's own seated baseline.
 *
 * Runs the exported gradient-boosted trees (signal-model.json) with no
 * dependencies. Output matches scikit-learn's predict_proba to within 1e-9.
 *
 *   const model = parseSignalModel(json);
 *   const p = classifyWindow(model, window, baseline); // { rest, stress, exercise, label }
 *
 * Window features (Empatica E4: HR 1 Hz, EDA 4 Hz, TEMP 4 Hz, ACC 32 Hz):
 *   hr_mean, hr_std (bpm), hr_slope (bpm/min),
 *   eda_mean, eda_std (uS), eda_slope (uS/min), eda_rise (sum of positive EDA steps),
 *   temp_mean (C), temp_slope (C/min),
 *   acc_mean, acc_std (g, magnitude of raw counts / 64), acc_jerk (g/s).
 * Baseline: hr_mean, eda_mean, temp_mean averaged over the last 180 s of a seated rest.
 */

export type SignalClass = 'rest' | 'stress' | 'exercise';

export const SIGNAL_CLASSES: readonly SignalClass[] = ['rest', 'stress', 'exercise'];

export const WINDOW_FEATURES = [
  'hr_mean', 'hr_std', 'hr_slope',
  'eda_mean', 'eda_std', 'eda_slope', 'eda_rise',
  'temp_mean', 'temp_slope',
  'acc_mean', 'acc_std', 'acc_jerk',
] as const;

export type WindowFeature = (typeof WINDOW_FEATURES)[number];

/** The model's 12 inputs, in order. */
export const FEATURE_ORDER = [
  'hr_delta', 'eda_log_ratio', 'temp_delta',
  'hr_std', 'hr_slope', 'eda_std', 'eda_slope', 'eda_rise',
  'temp_slope', 'acc_mean', 'acc_std', 'acc_jerk',
] as const;

export type ModelFeature = (typeof FEATURE_ORDER)[number];

export const DEFAULT_EDA_EPS = 0.05;

/** Inputs are snapped to a 2^-30 grid before the trees (see snapFeatures). */
export const DEFAULT_SNAP_SCALE = 1073741824;

/** Raw features of one 30-second window. */
export type SignalWindow = Record<WindowFeature, number>;

/** The person's seated-baseline levels. */
export interface SignalBaseline {
  hr_mean: number;
  eda_mean: number;
  temp_mean: number;
}

/**
 * One regression tree as parallel arrays over its nodes (node 0 is the root).
 *   f: feature index into FEATURE_ORDER; -1 marks a leaf
 *   t: split threshold for split nodes (x <= t goes left); leaf value for leaves
 *   m: 1 if a missing (NaN) input goes left, else 0
 *   l, r: left and right child indices (0 for leaves)
 */
export interface SignalTree {
  f: number[];
  t: number[];
  m: number[];
  l: number[];
  r: number[];
}

export interface SignalEvaluation {
  method: string;
  balanced_accuracy: number;
  auc_stress_vs_rest_per_subject_mean: number;
  [metric: string]: unknown;
}

export interface SignalModel {
  name: string;
  version: string;
  kind: 'hist-gradient-boosting';
  classes: SignalClass[];
  features: { order: ModelFeature[]; [formula: string]: unknown };
  eda_eps: number;
  /** Each input x becomes floor(x * scale + 0.5) / scale before the trees. */
  input_snap_scale: number;
  /** Starting raw score per class, before any tree. */
  baseline_prediction: number[];
  /** trees[iteration][classIndex]; a class's raw score is the sum of its trees. */
  trees: SignalTree[][];
  evaluation: SignalEvaluation;
  [extra: string]: unknown;
}

export type SignalProbabilities = Record<SignalClass, number>;

export interface SignalClassification extends SignalProbabilities {
  /** The most probable class. */
  label: SignalClass;
}

/** The 12 model inputs, in FEATURE_ORDER (predict snaps them to the model grid). */
export function personalFeatures(
  window: SignalWindow,
  baseline: SignalBaseline,
  edaEps: number = DEFAULT_EDA_EPS,
): number[] {
  return [
    window.hr_mean - baseline.hr_mean,
    Math.log(window.eda_mean + edaEps) - Math.log(baseline.eda_mean + edaEps),
    window.temp_mean - baseline.temp_mean,
    window.hr_std,
    window.hr_slope,
    window.eda_std,
    window.eda_slope,
    window.eda_rise,
    window.temp_slope,
    window.acc_mean,
    window.acc_std,
    window.acc_jerk,
  ];
}

function treeValue(tree: SignalTree, x: readonly number[]): number {
  const { f, t, m, l, r } = tree;
  let node = 0;
  for (;;) {
    const feature = f[node] ?? -1;
    const threshold = t[node] ?? Number.NaN;
    if (feature < 0) return threshold;
    const v = x[feature] ?? Number.NaN;
    const goLeft = Number.isNaN(v) ? m[node] === 1 : v <= threshold;
    const next = goLeft ? l[node] : r[node];
    // Children always come after their parent (pre-order), so this terminates.
    if (next === undefined || next <= node) throw new Error(`malformed tree at node ${node}`);
    node = next;
  }
}

/**
 * Snap inputs to the model's grid (2^-30, about 1e-9). This removes float
 * rounding noise, so a feature computed with a different summation order or
 * from shifted levels lands on the same side of every split. Exact IEEE
 * arithmetic: Python and JavaScript produce identical values.
 */
export function snapFeatures(features: readonly number[], scale: number = DEFAULT_SNAP_SCALE): number[] {
  return features.map((v) => Math.floor(v * scale + 0.5) / scale);
}

/** Summed tree outputs per class (before softmax). */
export function rawScores(model: SignalModel, features: readonly number[]): number[] {
  if (features.length !== model.features.order.length) {
    throw new Error(`expected ${model.features.order.length} features, got ${features.length}`);
  }
  const x = snapFeatures(features, model.input_snap_scale);
  const raw = model.baseline_prediction.slice();
  for (const iteration of model.trees) {
    iteration.forEach((tree, k) => {
      raw[k] = (raw[k] ?? 0) + treeValue(tree, x);
    });
  }
  return raw;
}

/** Class probabilities: softmax over the summed tree outputs. */
export function predict(model: SignalModel, features: readonly number[]): SignalProbabilities {
  const raw = rawScores(model, features);
  const top = Math.max(...raw);
  const exp = raw.map((z) => Math.exp(z - top));
  let sum = 0;
  for (const e of exp) sum += e;
  const out: SignalProbabilities = { rest: 0, stress: 0, exercise: 0 };
  model.classes.forEach((c, k) => {
    out[c] = (exp[k] ?? 0) / sum;
  });
  return out;
}

export function classifyWindow(
  model: SignalModel,
  window: SignalWindow,
  baseline: SignalBaseline,
): SignalClassification {
  const p = predict(model, personalFeatures(window, baseline, model.eda_eps));
  let label: SignalClass = 'rest';
  for (const c of SIGNAL_CLASSES) if (p[c] > p[label]) label = c;
  return { ...p, label };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isArray(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

function isNumberArray(v: unknown): v is number[] {
  return isArray(v) && v.every((x) => typeof x === 'number');
}

function fail(why: string): never {
  throw new Error(`invalid signal model: ${why}`);
}

function checkTree(tree: unknown): void {
  if (!isRecord(tree)) return fail('tree');
  const f = tree['f'];
  const t = tree['t'];
  const m = tree['m'];
  const l = tree['l'];
  const r = tree['r'];
  if (!isNumberArray(f) || !isNumberArray(t) || !isNumberArray(m) || !isNumberArray(l) || !isNumberArray(r)) {
    return fail('tree arrays');
  }
  const n = f.length;
  if (n === 0 || t.length !== n || m.length !== n || l.length !== n || r.length !== n) fail('tree array lengths');
  for (let i = 0; i < n; i++) {
    const fi = f[i] ?? -1;
    const li = l[i] ?? 0;
    const ri = r[i] ?? 0;
    if (fi >= FEATURE_ORDER.length) fail('feature index');
    if (fi >= 0 && !(li > i && ri > i && li < n && ri < n)) fail('child index');
  }
}

/** Checks the shape of a parsed signal-model.json and returns it typed. */
export function parseSignalModel(json: unknown): SignalModel {
  if (!isRecord(json)) return fail('not an object');
  if (json['kind'] !== 'hist-gradient-boosting') fail('kind');
  const classes = json['classes'];
  if (!isArray(classes) || classes.join() !== SIGNAL_CLASSES.join()) fail('classes');
  const features = json['features'];
  if (!isRecord(features)) return fail('features');
  const order = features['order'];
  if (!isArray(order) || order.join() !== FEATURE_ORDER.join()) fail('features.order');
  if (typeof json['eda_eps'] !== 'number') fail('eda_eps');
  const snap = json['input_snap_scale'];
  if (typeof snap !== 'number' || !(snap > 0)) fail('input_snap_scale');
  const base = json['baseline_prediction'];
  if (!isNumberArray(base) || base.length !== SIGNAL_CLASSES.length) fail('baseline_prediction');
  const trees = json['trees'];
  if (!isArray(trees) || trees.length === 0) return fail('trees');
  for (const iteration of trees) {
    if (!isArray(iteration) || iteration.length !== SIGNAL_CLASSES.length) return fail('trees iteration');
    iteration.forEach(checkTree);
  }
  if (!isRecord(json['evaluation'])) fail('evaluation');
  return json as SignalModel;
}
