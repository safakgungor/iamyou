"""Sensitivity of hgb/population vs hgb/personal_levels to analysis choices.

Report only: nothing here changes the chosen model.
  * baseline length: last 180 s (reference), 120 s, 60 s of the seated baseline
  * window length: 30 s (reference) vs 60 s (hop 10 s; minimum length scaled to 50 s)
  * HGB random seed: 0-4 as configured, and 0-4 with max_features=0.8 so that the seed
    actually changes the fit (with < 10,000 training rows and max_features=1.0 the model
    has no random component)
Window files come from build_windows_variant.py (windows/*.csv).

Usage: python -I sensitivity.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import pandas as pd
from scipy.stats import wilcoxon

from common import (HERE, RES, SIGNAL, bacc_from_cm, load, loso, per_subject_auc,
                    self_report_levels, subject_confusions, summarize)

WIN = os.path.join(HERE, 'windows')
RUNS = [
    # name, window file, seed, extra HGB kwargs
    ('reference (30 s windows, 180 s baseline, seed 0)', os.path.join(SIGNAL, 'windows.csv'), 0, {}),
    ('baseline 120 s', os.path.join(WIN, 'w30_b120.csv'), 0, {}),
    ('baseline 60 s', os.path.join(WIN, 'w30_b60.csv'), 0, {}),
    ('window 60 s', os.path.join(WIN, 'w60_b180.csv'), 0, {}),
] + [(f'seed {s}', os.path.join(SIGNAL, 'windows.csv'), s, {}) for s in (1, 2, 3, 4)] \
  + [(f'max_features 0.8, seed {s}', os.path.join(SIGNAL, 'windows.csv'), s, {'max_features': 0.8})
     for s in range(5)]

lv = self_report_levels()
rows, cache = [], {}
for name, path, seed, kw in RUNS:
    if path not in cache:
        cache[path] = load(path)
    data = cache[path]
    subjects = np.unique(data['groups'])
    per = {}
    for design in ('population', 'personal_levels'):
        p = loso(data['sets'][design], data['y'], data['groups'], 'hgb', seed=seed, **kw)
        s = summarize(p, data, levels=lv)
        cms = subject_confusions(data['y'], p.argmax(1), data['groups'], subjects)
        per[design] = dict(m=s, sbacc=bacc_from_cm(cms),
                           auc=per_subject_auc(p, data['y'], data['groups'], data['ev'], subjects))
    a, b = per['personal_levels'], per['population']
    d_auc = a['auc'] - b['auc']
    d_sb = a['sbacc'] - b['sbacc']
    row = dict(run=name, subjects=len(subjects), windows=len(data['y']),
               stress_windows=int((data['y'] == 1).sum()))
    for lab, s in (('pop', b['m']), ('pl', a['m'])):
        for k in ('balanced_accuracy', 'macro_f1', 'auc_per_subject', 'per_subject_bacc', 'spearman_within',
                  'recall_stress'):
            row[f'{lab}_{k}'] = s[k]
    row.update(diff_bacc=a['m']['balanced_accuracy'] - b['m']['balanced_accuracy'],
               diff_auc=float(np.mean(d_auc)), auc_better=int((d_auc > 0).sum()),
               auc_wilcoxon_p=float(wilcoxon(a['auc'], b['auc']).pvalue),
               diff_sbacc=float(np.mean(d_sb)), sbacc_better=int((d_sb > 0).sum()),
               sbacc_wilcoxon_p=float(wilcoxon(a['sbacc'], b['sbacc']).pvalue))
    rows.append(row)
    print(f"{name:48s} pop bacc {row['pop_balanced_accuracy']:.3f} AUC {row['pop_auc_per_subject']:.3f} | "
          f"PL bacc {row['pl_balanced_accuracy']:.3f} F1 {row['pl_macro_f1']:.3f} AUC {row['pl_auc_per_subject']:.3f} "
          f"rho {row['pl_spearman_within']:.2f} | d bacc {row['diff_bacc']:+.3f} d AUC {row['diff_auc']:+.3f} "
          f"({row['auc_better']}/{len(subjects)}, p={row['auc_wilcoxon_p']:.3f}) d sbacc {row['diff_sbacc']:+.3f} "
          f"({row['sbacc_better']}/{len(subjects)}, p={row['sbacc_wilcoxon_p']:.4f})", flush=True)

df = pd.DataFrame(rows)
df.to_csv(os.path.join(RES, 'sensitivity.csv'), index=False)
json.dump(rows, open(os.path.join(RES, 'sensitivity.json'), 'w'), indent=2)
print('saved', os.path.join(RES, 'sensitivity.csv'))
