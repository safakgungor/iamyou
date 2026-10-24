"""Shared pieces for exporting the iamyou Signal gradient-boosted model.

Data loading and the personal-level design matrix follow train.py exactly, so
the model trained here is the "hgb/personal_levels" configuration it scored.
"""
from decimal import Decimal, ROUND_HALF_EVEN

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier

FEATS = ['hr_mean', 'hr_std', 'hr_slope', 'eda_mean', 'eda_std', 'eda_slope',
         'eda_rise', 'temp_mean', 'temp_slope', 'acc_mean', 'acc_std', 'acc_jerk']
LEVELS = ['hr_mean', 'eda_mean', 'temp_mean']
SHAPE = [f for f in FEATS if f not in LEVELS]
ORDER = ['hr_delta', 'eda_log_ratio', 'temp_delta'] + SHAPE
CLASSES = ['rest', 'stress', 'exercise']
EDA_EPS = 0.05
HGB_PARAMS = dict(max_depth=4, learning_rate=0.06, max_iter=300,
                  class_weight='balanced', random_state=0)
# Size candidates scored by shrink_search.py (hyper-parameters on top of HGB_PARAMS)
SIZE_CONFIGS = {
    'depth4_unsnapped': dict(snap=False),  # train.py exactly: reproduces 0.772 / 0.799
    'depth4': {},
    'depth4_leaves12': dict(max_leaf_nodes=12),
    'depth4_leaves8': dict(max_leaf_nodes=8),
    'depth4_leaves6': dict(max_leaf_nodes=6),
    'depth3': dict(max_depth=3),
    'depth2': dict(max_depth=2),
}
# Leaf values rounded to 11 decimals: with <= 300 trees per class a raw score moves
# at most 300 * 0.5e-11 = 1.5e-9, and a softmax probability at most half of that.
LEAF_DECIMALS = 11
# Inputs are snapped to a 2^-30 (~9.3e-10) grid before the trees. Without it,
# sklearn places some splits between values that differ only by float rounding
# noise (~1e-15, e.g. two windows with the same quantised temperature pattern),
# so a feature recomputed with another summation order, or a shifted level,
# could land on the other side. floor(x * 2^30 + 0.5) / 2^30 is exact IEEE
# arithmetic, so Python and JavaScript snap identically.
SNAP_SCALE = 2.0 ** 30


def snap(X):
    return np.floor(np.asarray(X, dtype=float) * SNAP_SCALE + 0.5) / SNAP_SCALE


def load(windows_csv, snapped=True):
    """Rows, per-subject baselines, design matrix, labels and groups as in train.py."""
    d = pd.read_csv(windows_csv)
    ref = d[d.label == 'baseline'].groupby('subject')[FEATS].mean()
    ev = d[(d.label != 'baseline') & d.subject.isin(ref.index)].reset_index(drop=True)
    y = ev.label.map({c: i for i, c in enumerate(CLASSES)}).to_numpy()
    refs = ref.loc[ev.subject].reset_index(drop=True)
    X = design(ev, refs, snapped)
    assert np.isfinite(X).all()
    return d, ev, ref, refs, X, y, ev.subject.to_numpy()


def design(rows, refs, snapped=True):
    """12 personal-level inputs in ORDER; rows and refs are aligned DataFrames."""
    X = np.column_stack([
        rows.hr_mean.to_numpy() - refs.hr_mean.to_numpy(),
        np.log(rows.eda_mean.to_numpy() + EDA_EPS) - np.log(refs.eda_mean.to_numpy() + EDA_EPS),
        rows.temp_mean.to_numpy() - refs.temp_mean.to_numpy(),
        rows[SHAPE].to_numpy(),
    ])
    return snap(X) if snapped else X


def make_hgb(**overrides):
    return HistGradientBoostingClassifier(**{**HGB_PARAMS, **overrides})


def round_threshold(thr, sorted_vals):
    """Shortest decimal threshold that splits the training data like sklearn's.

    sklearn sends x <= thr left, with thr a midpoint between two training
    values lo < hi. The shortened threshold stays within a quarter of that gap
    of thr, so every training window keeps its side and no window sits within
    a rounding error of a split (e.g. after recomputing a delta in another
    language).
    """
    i = np.searchsorted(sorted_vals, thr, side='right')
    if i == 0 or i == len(sorted_vals):
        return float(thr)
    lo, hi = float(sorted_vals[i - 1]), float(sorted_vals[i])
    delta = 0.25 * (hi - lo)
    for p in range(0, 18):
        v = float(Decimal(float(thr)).quantize(Decimal(1).scaleb(-p), ROUND_HALF_EVEN))
        if abs(v - thr) <= delta and lo < v < hi:
            return v
    return float(thr)


def num(v):
    """JSON-friendly number: ints stay ints, so 13.0 is written as 13."""
    v = float(v)
    return int(v) if v.is_integer() and abs(v) < 2 ** 53 else v


def export_trees(clf, X_train, round_values=True):
    """Compact parallel-array trees: one dict per class per iteration.

    f: feature index into ORDER, -1 marks a leaf (is_leaf)
    t: split threshold (x <= t goes left) for split nodes, leaf value for leaves
    m: 1 if a missing (NaN) input goes left, else 0 (leaves: 0)
    l, r: child node indices (leaves: 0)
    """
    sorted_cols = [np.unique(X_train[:, j]) for j in range(X_train.shape[1])]
    out = []
    for it in clf._predictors:
        row = []
        for pred in it:
            nodes = pred.nodes
            assert not nodes['is_categorical'].any()
            f, t, m, l, r = [], [], [], [], []
            for n in nodes:
                if n['is_leaf']:
                    v = float(n['value'])
                    f.append(-1)
                    t.append(num(round(v, LEAF_DECIMALS)) if round_values else v)
                    m.append(0); l.append(0); r.append(0)
                else:
                    j = int(n['feature_idx'])
                    thr = float(n['num_threshold'])
                    f.append(j)
                    t.append(num(round_threshold(thr, sorted_cols[j])) if round_values else thr)
                    m.append(int(n['missing_go_to_left'])); l.append(int(n['left'])); r.append(int(n['right']))
            row.append(dict(f=f, t=t, m=m, l=l, r=r))
        out.append(row)
    return out


def predict_trees(trees, baseline, X):
    """Reference inference over the exported arrays (vectorised for speed)."""
    raw = np.tile(np.asarray(baseline, dtype=float), (len(X), 1))
    for row in trees:
        for k, tr in enumerate(row):
            f = np.asarray(tr['f']); t = np.asarray(tr['t'], dtype=float)
            m = np.asarray(tr['m']); l = np.asarray(tr['l']); r = np.asarray(tr['r'])
            node = np.zeros(len(X), dtype=int)
            while True:
                fi = f[node]
                active = fi >= 0
                if not active.any():
                    break
                idx = np.flatnonzero(active)
                x = X[idx, fi[idx]]
                go_left = np.where(np.isnan(x), m[node[idx]] == 1, x <= t[node[idx]])
                node[idx] = np.where(go_left, l[node[idx]], r[node[idx]])
            raw[:, k] += t[node]
    return raw


def softmax(raw):
    z = raw - raw.max(axis=1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=1, keepdims=True)
