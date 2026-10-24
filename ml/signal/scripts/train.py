"""Population vs personal-baseline models for rest / stress / exercise.

Usage: python -I train.py <windows.csv> <raw dir> <out dir>

Every model is scored leave-one-subject-out: the test person never appears in
training. The personal model sees each feature as a difference from that
person's own seated baseline, recorded on their stress-protocol day.
Baseline windows define the reference and are never scored.
"""
import json
import warnings
import os
import sys

import numpy as np
import pandas as pd
from scipy.stats import spearmanr, wilcoxon
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import balanced_accuracy_score, f1_score, roc_auc_score, confusion_matrix
from sklearn.model_selection import LeaveOneGroupOut
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

WINDOWS, RAW, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
# numpy 2 + Apple Accelerate emits spurious matmul RuntimeWarnings; inputs are checked finite below
warnings.filterwarnings('ignore', category=RuntimeWarning)
os.makedirs(OUT, exist_ok=True)
FEATS = ['hr_mean', 'hr_std', 'hr_slope', 'eda_mean', 'eda_std', 'eda_slope',
         'eda_rise', 'temp_mean', 'temp_slope', 'acc_mean', 'acc_std', 'acc_jerk']
CLASSES = ['rest', 'stress', 'exercise']

d = pd.read_csv(WINDOWS)
ref = d[d.label == 'baseline'].groupby('subject')[FEATS].mean()
ev = d[(d.label != 'baseline') & d.subject.isin(ref.index)].reset_index(drop=True)
y = ev.label.map({c: i for i, c in enumerate(CLASSES)}).to_numpy()
groups = ev.subject.to_numpy()
raw = ev[FEATS].to_numpy()
delta = raw - ref.loc[ev.subject, FEATS].to_numpy()
LEVELS = ['hr_mean', 'eda_mean', 'temp_mean']
EDA_EPS = 0.05  # microsiemens; keeps the log ratio finite near zero
levels = ev[LEVELS].to_numpy()
ref_levels = ref.loc[ev.subject, LEVELS].to_numpy()
level_delta = np.column_stack([
    levels[:, 0] - ref_levels[:, 0],
    np.log(levels[:, 1] + EDA_EPS) - np.log(ref_levels[:, 1] + EDA_EPS),
    levels[:, 2] - ref_levels[:, 2]])
shape = ev[[f for f in FEATS if f not in LEVELS]].to_numpy()
assert np.isfinite(raw).all() and np.isfinite(level_delta).all()
SETS = {'population': raw, 'personal': delta, 'hybrid': np.hstack([raw, delta]),
        'personal_levels': np.hstack([level_delta, shape])}


def make_model(kind):
    if kind == 'logreg':
        return make_pipeline(StandardScaler(), LogisticRegression(
            C=0.5, class_weight='balanced', max_iter=5000))
    return HistGradientBoostingClassifier(max_depth=4, learning_rate=0.06, max_iter=300,
                                          class_weight='balanced', random_state=0)


def loso(X, kind):
    proba = np.zeros((len(X), len(CLASSES)))
    for tr, te in LeaveOneGroupOut().split(X, y, groups):
        m = make_model(kind).fit(X[tr], y[tr])
        proba[te] = m.predict_proba(X[te])
    return proba


def stress_vs_rest(p):
    return p[:, 1] / (p[:, 0] + p[:, 1] + 1e-12)


def per_subject(proba):
    pred = proba.argmax(1)
    rows = []
    for s in np.unique(groups):
        m = groups == s
        r = dict(subject=s, bacc=balanced_accuracy_score(y[m], pred[m]))
        sr = m & (ev.protocol == 'STRESS').to_numpy() & (y != 2)
        if len(np.unique(y[sr])) == 2:
            r['auc_stress_rest'] = roc_auc_score(y[sr] == 1, stress_vs_rest(proba[sr]))
        rows.append(r)
    return pd.DataFrame(rows).set_index('subject')


# Self-reported stress per phase (1-10), reported at the end of each phase
levels = {}
for v in ('v1', 'v2'):
    t = pd.read_csv(os.path.join(RAW, f'Stress_Level_{v}.csv'), index_col=0)
    t.columns = [c.strip() for c in t.columns]
    for subj, row in t.iterrows():
        for phase, val in row.items():
            levels[(str(subj).strip(), phase)] = float(val)


def self_report(proba):
    st = ev[ev.protocol == 'STRESS'].copy()
    st['p'] = stress_vs_rest(proba[st.index])
    agg = st.groupby(['subject', 'phase']).p.mean().reset_index()
    agg['sl'] = [levels.get((s, ph), np.nan) for s, ph in zip(agg.subject, agg.phase)]
    agg = agg.dropna()
    within = []
    for s, g in agg.groupby('subject'):
        if g.sl.nunique() > 1 and len(g) >= 4:
            within.append(spearmanr(g.p, g.sl).statistic)
    return float(np.nanmean(within)), len(within), float(spearmanr(agg.p, agg.sl).statistic)


results, per_subj, probas = {}, {}, {}
for kind in ('logreg', 'hgb'):
    for name, X in SETS.items():
        key = f'{kind}/{name}'
        p = loso(X, kind)
        probas[key] = p
        pred = p.argmax(1)
        ps = per_subject(p)
        per_subj[key] = ps
        sr = (ev.protocol == 'STRESS').to_numpy() & (y != 2)
        within, n_within, pooled = self_report(p)
        results[key] = dict(
            balanced_accuracy=balanced_accuracy_score(y, pred),
            macro_f1=f1_score(y, pred, average='macro'),
            recall={c: float((pred[y == i] == i).mean()) for i, c in enumerate(CLASSES)},
            auc_stress_vs_rest_pooled=roc_auc_score(y[sr] == 1, stress_vs_rest(p[sr])),
            auc_stress_vs_rest_per_subject_mean=float(ps.auc_stress_rest.mean()),
            auc_stress_vs_rest_per_subject_sd=float(ps.auc_stress_rest.std()),
            per_subject_bacc_mean=float(ps.bacc.mean()),
            self_report_spearman_within=within, self_report_subjects=n_within,
            self_report_spearman_pooled=pooled,
            confusion=confusion_matrix(y, pred).tolist(),
        )
        print(f'{key:22s} bacc {results[key]["balanced_accuracy"]:.3f}  f1 {results[key]["macro_f1"]:.3f}  '
              f'AUC s/r pooled {results[key]["auc_stress_vs_rest_pooled"]:.3f}  '
              f'per-subj {ps.auc_stress_rest.mean():.3f}±{ps.auc_stress_rest.std():.3f}  '
              f'SL rho {within:.2f} (n={n_within})  recall {results[key]["recall"]}')

# Paired tests: personal vs population, same subjects, same model family
tests = {}
for kind in ('logreg', 'hgb'):
    b = per_subj[f'{kind}/population']
    for name in ('personal', 'hybrid', 'personal_levels'):
      a = per_subj[f'{kind}/{name}']
      for metric in ('bacc', 'auc_stress_rest'):
        j = pd.concat([a[metric], b[metric]], axis=1, keys=['personal', 'population']).dropna()
        diff = j.personal - j.population
        tests[f'{kind}/{name}/{metric}'] = dict(
            n=len(j), personal_mean=float(j.personal.mean()), population_mean=float(j.population.mean()),
            mean_diff=float(diff.mean()), better=int((diff > 0).sum()), worse=int((diff < 0).sum()),
            wilcoxon_p=float(wilcoxon(j.personal, j.population).pvalue))
        print(f'{kind}/{name}/{metric}: {j.personal.mean():.3f} vs population {j.population.mean():.3f}, '
              f'diff {diff.mean():+.3f}, better in {(diff > 0).sum()}/{len(j)}, '
              f'Wilcoxon p={tests[f"{kind}/{name}/{metric}"]["wilcoxon_p"]:.4f}')

meta = dict(windows=int(len(ev)), subjects=int(ev.subject.nunique()),
            class_counts={c: int((y == i).sum()) for i, c in enumerate(CLASSES)},
            features=FEATS, classes=CLASSES)
json.dump(dict(meta=meta, results=results, tests=tests), open(os.path.join(OUT, 'results.json'), 'w'), indent=2)
for k, ps in per_subj.items():
    ps.to_csv(os.path.join(OUT, f'per_subject_{k.replace("/", "_")}.csv'))
np.savez(os.path.join(OUT, 'oof.npz'), **{k.replace('/', '_'): v for k, v in probas.items()})
print(json.dumps(meta))
