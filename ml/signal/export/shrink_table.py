"""Merge the per-configuration shrink_search.py outputs into one trade-off table.

Usage: python -I shrink_table.py <windows.csv> <out shrink_search.json> <shrink_<config>.json ...>

Recomputes each size with the final export settings (leaf rounding, threshold
shortening) from a fit on all subjects. The reference is the train.py model
(depth 4, 300 iterations, unsnapped), re-scored here. A candidate qualifies when
  - balanced accuracy and stress-vs-rest AUC are within +-0.005 of the reference,
  - macro F1 is at most 0.005 below it (keeps the rest/stress recall balance), and
  - out-of-fold log loss is no worse (rules out under-trained models, e.g. 20
    iterations, that match on argmax and ranking but squeeze probabilities to 1/3).
The smallest qualifying snapped candidate is the pick.
"""
import json
import os
import sys
import warnings

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from signal_common import SIZE_CONFIGS, export_trees, load, make_hgb  # noqa: E402

warnings.filterwarnings('ignore', category=RuntimeWarning)
WINDOWS, OUT, PARTS = sys.argv[1], sys.argv[2], sys.argv[3:]
TRAIN_PY_BACC, TRAIN_PY_AUC, TOL = 0.7719656440521295, 0.7986258699989396, 0.005  # out/results.json
KW = {k: {kk: vv for kk, vv in v.items() if kk != 'snap'} for k, v in SIZE_CONFIGS.items()}

_, _, _, _, X, y, _ = load(WINDOWS)
X_raw = load(WINDOWS, snapped=False)[4]
rows = [r for p in PARTS for r in json.load(open(p))]
ref = next(r for r in rows if r['config'] == 'depth4_unsnapped' and r['iterations'] == 300)
assert abs(ref['balanced_accuracy'] - TRAIN_PY_BACC) < 1e-12 and abs(ref['auc_stress_vs_rest_per_subject'] - TRAIN_PY_AUC) < 1e-12
REF_BACC, REF_AUC = ref['balanced_accuracy'], ref['auc_stress_vs_rest_per_subject']
REF_F1, REF_LL = ref['macro_f1'], ref['log_loss']
trees = {}
for r in rows:
    c = r['config']
    if c not in trees:
        Xc = X_raw if c.endswith('unsnapped') else X
        trees[c] = export_trees(make_hgb(**KW[c]).fit(Xc, y), Xc)
    r['trees_json_bytes'] = len(json.dumps(trees[c][:r['iterations']], separators=(',', ':')))
    r['d_bacc'] = r['balanced_accuracy'] - REF_BACC
    r['d_auc'] = r['auc_stress_vs_rest_per_subject'] - REF_AUC
    r['d_f1'] = r['macro_f1'] - REF_F1
    r['within_0.005'] = bool(abs(r['d_bacc']) <= TOL and abs(r['d_auc']) <= TOL)
    r['qualifies'] = bool(r['within_0.005'] and r['d_f1'] >= -TOL and r['log_loss'] <= REF_LL)
rows.sort(key=lambda r: r['trees_json_bytes'])
ok = [r for r in rows if r['qualifies'] and not r['config'].endswith('unsnapped')]
pick = ok[0]
for r in rows:
    r['picked'] = r is pick
json.dump(dict(reference=dict(balanced_accuracy=REF_BACC, auc_stress_vs_rest_per_subject=REF_AUC,
                              macro_f1=REF_F1, log_loss=REF_LL, tolerance=TOL),
               picked=dict(config=pick['config'], iterations=pick['iterations']), rows=rows),
          open(OUT, 'w'), indent=1)

print(f'reference (train.py, depth 4, 300 iterations): bacc {REF_BACC:.4f}, AUC {REF_AUC:.4f}, '
      f'macro F1 {REF_F1:.4f}, log loss {REF_LL:.4f}')
print(f'picked: {pick["config"]} @ {pick["iterations"]} iterations')
print('| config | iterations | trees KB | balanced acc (d) | stress-vs-rest AUC (d) | macro F1 (d) | log loss | qualifies |')
print('|---|---:|---:|---:|---:|---:|---:|:---:|')
show = {50, 100, 150, 200, 250, 300}
for r in sorted(rows, key=lambda r: (r['config'], r['iterations'])):
    if r['iterations'] in show or r['picked'] or (r['within_0.005'] and r['trees_json_bytes'] < 260 * 1024):
        print(f'| {r["config"]} | {r["iterations"]} | {r["trees_json_bytes"] / 1024:.0f} | '
              f'{r["balanced_accuracy"]:.4f} ({r["d_bacc"]:+.4f}) | '
              f'{r["auc_stress_vs_rest_per_subject"]:.4f} ({r["d_auc"]:+.4f}) | '
              f'{r["macro_f1"]:.4f} ({r["d_f1"]:+.4f}) | {r["log_loss"]:.4f} | '
              f'{"PICK" if r["picked"] else ("yes" if r["qualifies"] else ("bacc/AUC only" if r["within_0.005"] else ""))} |')
