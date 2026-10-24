"""Sanity check: the shared code reproduces out/results.json from out/oof.npz,
and one HGB fit's cost / seed behaviour."""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from common import *

data = load(os.path.join(SIGNAL, 'windows.csv'))
oof = np.load(os.path.join(SIGNAL, 'out', 'oof.npz'))
ref = json.load(open(os.path.join(SIGNAL, 'out', 'results.json')))['results']
lv = self_report_levels()
for c in ['hgb/population', 'hgb/personal_levels']:
    s = summarize(oof[c.replace('/', '_')], data, levels=lv)
    r = ref[c]
    print(c, {k: round(v, 4) for k, v in s.items()})
    print('   ref', round(r['balanced_accuracy'], 4), round(r['macro_f1'], 4), round(r['per_subject_bacc_mean'], 4),
          round(r['auc_stress_vs_rest_per_subject_mean'], 4), round(r['self_report_spearman_within'], 4))
X, y, g = data['sets']['personal_levels'], data['y'], data['groups']
tr, te = np.flatnonzero(g != 'S07'), np.flatnonzero(g == 'S07')
from threadpoolctl import threadpool_limits
for th in (1, 14):
    with threadpool_limits(th):
        t = time.time(); m = make_model('hgb').fit(X[tr], y[tr]); print('threads', th, 'fit s', round(time.time() - t, 2))
ps = [make_model('hgb', seed=s).fit(X[tr], y[tr]).predict_proba(X[te]) for s in (0, 1, 7)]
print('seed max abs diff', np.abs(ps[0] - ps[1]).max(), np.abs(ps[0] - ps[2]).max())
print('oof match', np.abs(ps[0] - oof['hgb_personal_levels'][te]).max())
print('n_train', len(tr), 'early stopping active?', m.do_early_stopping_ if hasattr(m, 'do_early_stopping_') else '?', m.n_iter_)
t = time.time(); make_model('logreg').fit(X[tr], y[tr]); print('logreg fit s', round(time.time() - t, 2))
