"""Size vs accuracy for smaller versions of the hgb/personal_levels model.

Usage: python -I shrink_search.py <windows.csv> <out.json> [config ...]

Same leave-one-subject-out protocol and metrics as train.py. Fewer iterations
are read from staged predictions of each fold's 300-iteration model, which is
exactly the model max_iter=k would fit (no early stopping below 10000 rows, no
subsampling). Size is the compact JSON of the all-subjects model. Inputs are snapped to the
2^-30 grid (see signal_common.py) except in 'depth4_unsnapped', which is train.py as is.
"""
import json
import os
import sys
import time
import warnings

import numpy as np
from sklearn.metrics import balanced_accuracy_score, f1_score, log_loss, roc_auc_score
from sklearn.model_selection import LeaveOneGroupOut

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from signal_common import load, make_hgb, export_trees, CLASSES, SIZE_CONFIGS  # noqa: E402

warnings.filterwarnings('ignore', category=RuntimeWarning)
WINDOWS, OUT = sys.argv[1], sys.argv[2]
_, ev, _, _, X_snap, y, groups = load(WINDOWS)
X_raw = load(WINDOWS, snapped=False)[4]
is_stress_proto = (ev.protocol == 'STRESS').to_numpy()

CONFIGS = SIZE_CONFIGS
ITERS = list(range(20, 301, 10))
if len(sys.argv) > 3:
    CONFIGS = {k: CONFIGS[k] for k in sys.argv[3:]}


def metrics(p):
    pred = p.argmax(1)
    aucs = []
    for s in np.unique(groups):
        sr = (groups == s) & is_stress_proto & (y != 2)
        if len(np.unique(y[sr])) == 2:
            q = p[sr, 1] / (p[sr, 0] + p[sr, 1] + 1e-12)
            aucs.append(roc_auc_score(y[sr] == 1, q))
    extra = dict(macro_f1=float(f1_score(y, pred, average='macro')),
                 recall={c: float((pred[y == i] == i).mean()) for i, c in enumerate(CLASSES)})
    return float(balanced_accuracy_score(y, pred)), float(np.mean(aucs)), float(log_loss(y, p, labels=[0, 1, 2])), extra


rows = []
for name, kw in CONFIGS.items():
    t0 = time.time()
    kw = dict(kw)
    X = X_snap if kw.pop('snap', True) else X_raw
    staged = {k: np.zeros((len(X), len(CLASSES))) for k in ITERS}
    for tr, te in LeaveOneGroupOut().split(X, y, groups):
        m = make_hgb(**kw).fit(X[tr], y[tr])
        for i, p in enumerate(m.staged_predict_proba(X[te]), start=1):
            if i in staged:
                staged[i][te] = p
    full = make_hgb(**kw).fit(X, y)
    for k in ITERS:
        bacc, auc, ll, extra = metrics(staged[k])
        trees = export_trees(full, X)[:k]
        size = len(json.dumps(trees, separators=(',', ':')))
        rows.append(dict(config=name, iterations=k, balanced_accuracy=bacc,
                         auc_stress_vs_rest_per_subject=auc, log_loss=ll, trees_json_bytes=size,
                         nodes=int(sum(len(t['f']) for it in trees for t in it)), **extra))
        print(f'{name:16s} it={k:3d}  bacc {bacc:.4f}  auc {auc:.4f}  logloss {ll:.4f}  {size / 1024:6.1f} KB',
              flush=True)
    print(f'  ({time.time() - t0:.0f} s)', flush=True)

json.dump(rows, open(OUT, 'w'), indent=1)
