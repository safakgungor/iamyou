"""Train the shipped iamyou Signal model on every subject and export it as JSON.

Usage: python -I export_hgb.py <windows.csv> <results.json> <shrink_search.json>
                               <out model.json> <out test-vectors.json> <out oof.npz>

Configuration "hgb/personal_levels" from train.py: HistGradientBoostingClassifier
(learning_rate=0.06, class_weight='balanced', random_state=0) on 12 personal-level
inputs snapped to a 2^-30 grid, with the tree size and iteration count picked by
shrink_table.py (smallest model within 0.005 of train.py's LOSO scores). The script
  1. re-scores the shipped size leave-one-subject-out (same protocol as train.py),
  2. fits it on all subjects with a baseline and writes the compact JSON,
  3. checks the JSON against sklearn predict_proba on every training window,
     both vectorised and with the pure-Python signal_infer.py,
  4. writes TypeScript test vectors (10 real windows per class).
"""
import json
import os
import sys
import time
import warnings
from datetime import date

import numpy as np
from sklearn.metrics import balanced_accuracy_score, confusion_matrix, f1_score, log_loss, roc_auc_score
from sklearn.model_selection import LeaveOneGroupOut

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from signal_common import (CLASSES, EDA_EPS, FEATS, HGB_PARAMS, LEAF_DECIMALS, LEVELS, ORDER,  # noqa: E402
                           SIZE_CONFIGS, SNAP_SCALE, export_trees, load, make_hgb, predict_trees, softmax)
import signal_infer  # noqa: E402

warnings.filterwarnings('ignore', category=RuntimeWarning)
WINDOWS, RESULTS, SEARCH, OUT_MODEL, OUT_VECTORS, OUT_OOF = sys.argv[1:7]
search = json.load(open(SEARCH))
PICK = search['picked']
ITERS = PICK['iterations']
params = dict(max_iter=ITERS, **{k: v for k, v in SIZE_CONFIGS[PICK['config']].items() if k != 'snap'})
print('shipping', PICK, params)

d, ev, ref, refs, X, y, groups = load(WINDOWS)
is_stress_proto = (ev.protocol == 'STRESS').to_numpy()

# 1. Leave-one-subject-out for the shipped size
t0 = time.time()
oof = np.zeros((len(X), len(CLASSES)))
for tr, te in LeaveOneGroupOut().split(X, y, groups):
    oof[te] = make_hgb(**params).fit(X[tr], y[tr]).predict_proba(X[te])
pred = oof.argmax(1)
aucs = {}
for s in np.unique(groups):
    sr = (groups == s) & is_stress_proto & (y != 2)
    if len(np.unique(y[sr])) == 2:
        aucs[s] = roc_auc_score(y[sr] == 1, oof[sr, 1] / (oof[sr, 0] + oof[sr, 1] + 1e-12))
sr = is_stress_proto & (y != 2)
evaluation = dict(
    method='leave-one-subject-out: each subject scored by a model trained without them',
    subjects=int(len(np.unique(groups))), windows=int(len(X)),
    balanced_accuracy=float(balanced_accuracy_score(y, pred)),
    macro_f1=float(f1_score(y, pred, average='macro')),
    recall={c: float((pred[y == i] == i).mean()) for i, c in enumerate(CLASSES)},
    auc_stress_vs_rest_per_subject_mean=float(np.mean(list(aucs.values()))),
    auc_stress_vs_rest_per_subject_sd=float(np.std(list(aucs.values()), ddof=1)),
    auc_stress_vs_rest_pooled=float(roc_auc_score(
        y[sr] == 1, oof[sr, 1] / (oof[sr, 0] + oof[sr, 1] + 1e-12))),
    log_loss=float(log_loss(y, oof, labels=[0, 1, 2])),
    confusion=dict(rows='true class', cols='predicted class',
                   matrix=confusion_matrix(y, pred).tolist()),
)
np.savez(OUT_OOF, proba=oof, subject=groups, protocol=ev.protocol.to_numpy(),
         label=ev.label.to_numpy(), phase=ev.phase.to_numpy(), t_start=ev.t_start.to_numpy())
print(f'LOSO ({time.time() - t0:.0f} s): bacc {evaluation["balanced_accuracy"]:.4f}  '
      f'AUC stress/rest per subject {evaluation["auc_stress_vs_rest_per_subject_mean"]:.4f}')

ref_full = json.load(open(RESULTS))['results']['hgb/personal_levels']
evaluation['reference'] = dict(
    model='train.py hgb/personal_levels: max_depth 4, 300 iterations (about 540 KB as JSON)',
    balanced_accuracy=ref_full['balanced_accuracy'],
    auc_stress_vs_rest_per_subject_mean=ref_full['auc_stress_vs_rest_per_subject_mean'],
    macro_f1=ref_full['macro_f1'], recall=ref_full['recall'],
    log_loss=search['reference']['log_loss'])
evaluation['size_selection'] = (
    'smallest candidate (depth 2-4, 4-16 leaves, 20-300 iterations) whose LOSO balanced accuracy and '
    'stress-vs-rest AUC are within 0.005 of the reference, macro F1 at most 0.005 lower and log loss '
    'no worse; table in export/shrink_search.json')

# 2. Fit on all subjects with a baseline and export
clf = make_hgb(**params).fit(X, y)
assert clf.n_iter_ == ITERS and not clf.do_early_stopping_
assert abs(evaluation['balanced_accuracy'] - ref_full['balanced_accuracy']) <= 0.005
assert abs(evaluation['auc_stress_vs_rest_per_subject_mean'] - ref_full['auc_stress_vs_rest_per_subject_mean']) <= 0.005
trees = export_trees(clf, X)
config = {**HGB_PARAMS, **params}
model = dict(
    name='iamyou-signal', version='1.0.0', kind='hist-gradient-boosting', trained=str(date.today()),
    description=("Rest, stress or exercise from a 30-second wrist window, judged against "
                 "the person's own seated baseline."),
    data=dict(source=('PhysioNet Wearable Device Dataset from Induced Stress and Structured '
                      'Exercise Sessions v1.0.1 (Empatica E4)'),
              doi='https://doi.org/10.13026/he0v-tf17', license='ODC-By 1.0',
              subjects=int(len(np.unique(groups))), windows=int(len(X)),
              class_counts={c: int((y == i).sum()) for i, c in enumerate(CLASSES)}),
    window=dict(seconds=30, hop_seconds=10, hr_hz=1, eda_hz=4, temp_hz=4, acc_hz=32,
                acc_units='magnitude sqrt(x^2+y^2+z^2) of raw counts / 64, in g',
                baseline='hr_mean, eda_mean, temp_mean averaged over 30-second windows (10 s hop) '
                         'in the last 180 s of a seated rest'),
    features=dict(
        order=ORDER,
        hr_delta='hr_mean - baseline.hr_mean (bpm)',
        eda_log_ratio=f'ln(eda_mean + eda_eps) - ln(baseline.eda_mean + eda_eps)',
        temp_delta='temp_mean - baseline.temp_mean (degrees C)',
        hr_std='standard deviation of HR (bpm, ddof 0)',
        hr_slope='least-squares slope of HR against time (bpm/min)',
        eda_std='standard deviation of EDA (uS, ddof 0)',
        eda_slope='least-squares slope of EDA (uS/min)',
        eda_rise='sum of positive sample-to-sample EDA steps (uS)',
        temp_slope='least-squares slope of skin temperature (degrees C/min)',
        acc_mean='mean ACC magnitude (g)',
        acc_std='standard deviation of ACC magnitude (g, ddof 0)',
        acc_jerk='mean absolute ACC magnitude step times 32 Hz (g/s)',
        snap='each input x is replaced by floor(x * input_snap_scale + 0.5) / input_snap_scale '
             'before the trees (a 2^-30 grid; removes float rounding noise)'),
    eda_eps=EDA_EPS,
    input_snap_scale=int(SNAP_SCALE),
    classes=CLASSES,
    output='probabilities = softmax(baseline_prediction + sum of trees[i][k] for each class k)',
    tree_layout=dict(
        trees='trees[iteration][class index], one regression tree per class per iteration',
        f='feature index into features.order; -1 marks a leaf (is_leaf)',
        t='split nodes: threshold, x <= t goes left; leaves: leaf value (learning rate applied)',
        m='1 if a missing (NaN) input goes left, else 0',
        l='left child index (0 at leaves)', r='right child index (0 at leaves)',
        rounding=(f'leaf values rounded to {LEAF_DECIMALS} decimals; each threshold shortened to the '
                  'shortest decimal within a quarter of the gap between the training values it '
                  'separates, so every training window stays on the same side')),
    training=dict(algorithm='sklearn HistGradientBoostingClassifier',
                  params={k: v for k, v in config.items()},
                  n_iterations=int(clf.n_iter_), n_trees=int(clf.n_iter_) * len(CLASSES),
                  n_nodes=int(sum(len(t['f']) for it in trees for t in it))),
    baseline_prediction=[float(v) for v in clf._baseline_prediction[0]],
    evaluation=evaluation,
    trees=trees,
)
text = json.dumps(model, separators=(',', ':'))
with open(OUT_MODEL, 'w') as f:
    f.write(text)
print(f'model: {len(text) / 1024:.1f} KB, {model["training"]["n_trees"]} trees, '
      f'{model["training"]["n_nodes"]} nodes')

# 3. Parity on every training window
sk = clf.predict_proba(X)
exact = softmax(predict_trees(export_trees(clf, X, round_values=False), clf._baseline_prediction[0], X))
vec = softmax(predict_trees(trees, model['baseline_prediction'], X))
loaded = signal_infer.load_model(OUT_MODEL)
py = np.zeros_like(sk)
feat_diff = 0.0
for i in range(len(ev)):
    window = {f: float(ev.at[i, f]) for f in FEATS}
    base = {f: float(refs.at[i, f]) for f in LEVELS}
    x = signal_infer.personal_features(window, base, loaded['eda_eps'])
    feat_diff = max(feat_diff, float(np.max(np.abs(np.asarray(signal_infer.snap_features(x)) - X[i]))))
    p = signal_infer.predict(loaded, x)
    py[i] = [p[c] for c in CLASSES]
parity = dict(
    windows=int(len(X)),
    unrounded_export_vs_sklearn=float(np.abs(exact - sk).max()),
    rounded_export_numpy_vs_sklearn=float(np.abs(vec - sk).max()),
    pure_python_vs_sklearn=float(np.abs(py - sk).max()),
    pure_python_feature_vs_training_matrix=feat_diff,
    argmax_agreement=float((py.argmax(1) == sk.argmax(1)).mean()))
print('parity on every training window:', json.dumps(parity))
assert parity['pure_python_vs_sklearn'] < 1e-9, parity
json.dump(parity, open(os.path.join(HERE, 'parity.json'), 'w'), indent=1)

# 4. Test vectors: 10 real windows per class, each from a different subject
rng = np.random.default_rng(7)
vectors = []
for k, c in enumerate(CLASSES):
    subjects = rng.permutation(np.unique(groups[y == k]))[:10]
    for s in subjects:
        i = int(rng.choice(np.flatnonzero((y == k) & (groups == s))))
        vectors.append(dict(
            id=f'{s}/{ev.at[i, "protocol"]}/{ev.at[i, "phase"]}/{ev.at[i, "t_start"]}',
            label=c,
            window={f: float(ev.at[i, f]) for f in FEATS},
            baseline={f: float(refs.at[i, f]) for f in LEVELS},
            features=[float(v) for v in X[i]],
            expected={cc: float(sk[i, kk]) for kk, cc in enumerate(CLASSES)}))
with open(OUT_VECTORS, 'w') as f:
    json.dump(dict(model=f'{model["name"]} {model["version"]}', tolerance=1e-9,
                   source='sklearn predict_proba of the exported model on real training windows',
                   vectors=vectors), f, indent=1)
print('test vectors:', len(vectors), {c: sum(v['label'] == c for v in vectors) for c in CLASSES})
