"""Nested leave-one-subject-out check of the design / model selection.

For every outer subject s, the feature design (and, in a second variant, the model
family too) is chosen by an inner LOSO over the other 32 subjects only; the chosen
configuration's ordinary LOSO model (trained on those same 32 subjects) then scores s.

Inner models: the inner fold "outer s, held-out t" trains on everyone except {s, t},
which is the same model as "outer t, held-out s". One fit per unordered pair serves
both, so 528 pairs x 8 configurations = 4,224 fits.

Usage: python -I nested.py
"""
import itertools
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from joblib import Parallel, delayed

from common import (CONFIGS, DESIGNS, RES, SIGNAL, bacc_from_cm, load, make_model,
                    per_subject_auc, subject_confusions, summarize, self_report_levels)

data = load(os.path.join(SIGNAL, 'windows.csv'))
y, groups, ev = data['y'], data['groups'], data['ev']
subjects = np.unique(groups)
S, N = len(subjects), len(y)
sid = np.searchsorted(subjects, groups)
oof = np.load(os.path.join(SIGNAL, 'out', 'oof.npz'))


def pair_chunk(chunk, sets, y, sid):
    """Fit every configuration on all subjects except each pair (a, b) in chunk."""
    from threadpoolctl import threadpool_limits
    import common
    results = []
    with threadpool_limits(1):
        for a, b in chunk:
            tr = np.flatnonzero((sid != a) & (sid != b))
            ia, ib = np.flatnonzero(sid == a), np.flatnonzero(sid == b)
            out = {}
            for c in common.CONFIGS:
                kind, design = c.split('/')
                X = sets[design]
                m = common.make_model(kind).fit(X[tr], y[tr])
                out[c] = (m.predict_proba(X[ia]), m.predict_proba(X[ib]))
            results.append((a, b, out))
    return results


t0 = time.time()
pairs = list(itertools.combinations(range(S), 2))
chunks = [pairs[i::48] for i in range(48)]
res = [r for part in Parallel(n_jobs=12)(delayed(pair_chunk)(ch, data['sets'], y, sid) for ch in chunks)
       for r in part]
print(f'{len(pairs)} pairs x {len(CONFIGS)} configs fitted in {time.time() - t0:.0f} s')

# inner[c][s] = inner-LOSO probabilities for every window of the training subjects of outer s
inner = {c: np.full((S, N, 3), np.nan) for c in CONFIGS}
for a, b, out in res:
    ia, ib = np.flatnonzero(sid == a), np.flatnonzero(sid == b)
    for c, (pa, pb) in out.items():
        inner[c][b][ia] = pa   # outer b, inner held-out a
        inner[c][a][ib] = pb   # outer a, inner held-out b

# inner scores per outer subject and configuration
inner_bacc = np.zeros((S, len(CONFIGS)))
inner_auc = np.zeros((S, len(CONFIGS)))
for s in range(S):
    keep = sid != s
    sub_tr = subjects[subjects != subjects[s]]
    for j, c in enumerate(CONFIGS):
        p = inner[c][s][keep]
        assert np.isfinite(p).all()
        cm = subject_confusions(y[keep], p.argmax(1), groups[keep], sub_tr).sum(0)
        inner_bacc[s, j] = bacc_from_cm(cm)
        sub = dict(ev=ev[keep].reset_index(drop=True))
        inner_auc[s, j] = np.nanmean(per_subject_auc(p, y[keep], groups[keep], sub['ev'], sub_tr))

hgb_cols = [CONFIGS.index(f'hgb/{d}') for d in DESIGNS]
schemes = {
    'hgb_design_by_bacc': (hgb_cols, inner_bacc),
    'hgb_design_by_auc': (hgb_cols, inner_auc),
    'any_config_by_bacc': (list(range(len(CONFIGS))), inner_bacc),
    'any_config_by_auc': (list(range(len(CONFIGS))), inner_auc),
}
lv = self_report_levels()
summary, stitched = {}, {}
for name, (cols, score) in schemes.items():
    choice = [CONFIGS[cols[int(np.argmax(score[s, cols]))]] for s in range(S)]
    p = np.zeros((N, 3))
    for s in range(S):
        m = sid == s
        p[m] = oof[choice[s].replace('/', '_')][m]
    stitched[name] = p
    counts = {c: choice.count(c) for c in sorted(set(choice), key=choice.count, reverse=True)}
    summary[name] = dict(chosen=counts, choice_by_subject=dict(zip(subjects.tolist(), choice)),
                         metrics=summarize(p, data, levels=lv))
    print(name, counts, {k: round(v, 3) for k, v in summary[name]['metrics'].items()})

# how the selected configuration ranks on the inner folds, for reference
mean_inner = {c: dict(bacc=float(inner_bacc[:, j].mean()), auc=float(inner_auc[:, j].mean()))
              for j, c in enumerate(CONFIGS)}
json.dump(dict(schemes=summary, mean_inner_scores=mean_inner, n_pairs=len(pairs)),
          open(os.path.join(RES, 'nested.json'), 'w'), indent=2)
np.savez(os.path.join(RES, 'nested_oof.npz'), **stitched)
print('saved', os.path.join(RES, 'nested.json'))
