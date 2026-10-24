"""Shared pieces for the robustness checks.

Mirrors SP/signal/scripts/train.py (same window filter, feature designs, models and
metrics) so the numbers line up with out/results.json. Imported by the scripts in this
folder; they put this folder on sys.path themselves because they run with python -I.
"""
import os
import warnings

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

warnings.filterwarnings('ignore', category=RuntimeWarning)

HERE = os.path.dirname(os.path.abspath(__file__))
SIGNAL = os.path.dirname(HERE)
RAW = os.path.join(SIGNAL, 'raw')
RES = os.path.join(HERE, 'results')
os.makedirs(RES, exist_ok=True)

FEATS = ['hr_mean', 'hr_std', 'hr_slope', 'eda_mean', 'eda_std', 'eda_slope',
         'eda_rise', 'temp_mean', 'temp_slope', 'acc_mean', 'acc_std', 'acc_jerk']
CLASSES = ['rest', 'stress', 'exercise']
LEVELS = ['hr_mean', 'eda_mean', 'temp_mean']
EDA_EPS = 0.05
DESIGNS = ['population', 'personal', 'hybrid', 'personal_levels']
KINDS = ['logreg', 'hgb']
CONFIGS = [f'{k}/{d}' for k in KINDS for d in DESIGNS]


def load(windows_csv, baseline_last_s=None):
    """Return evaluation windows, labels, groups and the four design matrices.

    baseline_last_s: if set, only baseline windows starting within the last
    `baseline_last_s` seconds of the 180 s baseline span are used as the reference
    (used only for sanity checks; the sensitivity run rebuilds windows instead).
    """
    d = pd.read_csv(windows_csv)
    base = d[d.label == 'baseline']
    ref = base.groupby('subject')[FEATS].mean()
    ev = d[(d.label != 'baseline') & d.subject.isin(ref.index)].reset_index(drop=True)
    y = ev.label.map({c: i for i, c in enumerate(CLASSES)}).to_numpy()
    groups = ev.subject.to_numpy()
    raw = ev[FEATS].to_numpy()
    delta = raw - ref.loc[ev.subject, FEATS].to_numpy()
    lv = ev[LEVELS].to_numpy()
    rl = ref.loc[ev.subject, LEVELS].to_numpy()
    level_delta = np.column_stack([
        lv[:, 0] - rl[:, 0],
        np.log(lv[:, 1] + EDA_EPS) - np.log(rl[:, 1] + EDA_EPS),
        lv[:, 2] - rl[:, 2]])
    shape = ev[[f for f in FEATS if f not in LEVELS]].to_numpy()
    assert np.isfinite(raw).all() and np.isfinite(level_delta).all()
    sets = {'population': raw, 'personal': delta, 'hybrid': np.hstack([raw, delta]),
            'personal_levels': np.hstack([level_delta, shape])}
    return dict(ev=ev, y=y, groups=groups, sets=sets, ref=ref)


def make_model(kind, seed=0, **hgb_kw):
    if kind == 'logreg':
        return make_pipeline(StandardScaler(), LogisticRegression(
            C=0.5, class_weight='balanced', max_iter=5000))
    kw = dict(max_depth=4, learning_rate=0.06, max_iter=300, class_weight='balanced',
              random_state=seed)
    kw.update(hgb_kw)
    return HistGradientBoostingClassifier(**kw)


def _fit_predict(X, y, tr, te, kind, seed, hgb_kw):
    from threadpoolctl import threadpool_limits
    with threadpool_limits(1):
        m = make_model(kind, seed, **hgb_kw).fit(X[tr], y[tr])
        return te, m.predict_proba(X[te])


def loso(X, y, groups, kind, seed=0, n_jobs=12, **hgb_kw):
    """Leave-one-subject-out out-of-fold class probabilities."""
    from joblib import Parallel, delayed
    subs = np.unique(groups)
    jobs = [(np.flatnonzero(groups != s), np.flatnonzero(groups == s)) for s in subs]
    out = Parallel(n_jobs=n_jobs)(delayed(_fit_predict)(X, y, tr, te, kind, seed, hgb_kw)
                                  for tr, te in jobs)
    proba = np.zeros((len(X), len(CLASSES)))
    for te, p in out:
        proba[te] = p
    return proba


def stress_vs_rest(p):
    return p[:, 1] / (p[:, 0] + p[:, 1] + 1e-12)


# ---- metrics computed from per-subject confusion matrices (fast to resample) ----

def subject_confusions(y, pred, groups, subjects):
    cms = np.zeros((len(subjects), 3, 3))
    for i, s in enumerate(subjects):
        m = groups == s
        np.add.at(cms[i], (y[m], pred[m]), 1)
    return cms


def bacc_from_cm(cm):
    """Balanced accuracy from a (..., 3, 3) confusion array; ignores absent classes
    like sklearn does."""
    rows = cm.sum(-1)
    diag = np.diagonal(cm, axis1=-2, axis2=-1)
    with np.errstate(invalid='ignore', divide='ignore'):
        rec = np.where(rows > 0, diag / np.where(rows > 0, rows, 1), np.nan)
    return np.nanmean(rec, axis=-1)


def f1_from_cm(cm):
    """Macro-F1 over classes present in y_true or y_pred (sklearn default)."""
    rows = cm.sum(-1)
    cols = cm.sum(-2)
    tp = np.diagonal(cm, axis1=-2, axis2=-1)
    denom = rows + cols
    with np.errstate(invalid='ignore', divide='ignore'):
        f1 = np.where(denom > 0, 2 * tp / np.where(denom > 0, denom, 1), np.nan)
    return np.nanmean(f1, axis=-1)


def per_subject_auc(proba, y, groups, ev, subjects):
    out = np.full(len(subjects), np.nan)
    stress_day = (ev.protocol == 'STRESS').to_numpy() & (y != 2)
    for i, s in enumerate(subjects):
        m = (groups == s) & stress_day
        if len(np.unique(y[m])) == 2:
            out[i] = roc_auc_score(y[m] == 1, stress_vs_rest(proba[m]))
    return out


def self_report_levels():
    levels = {}
    for v in ('v1', 'v2'):
        t = pd.read_csv(os.path.join(RAW, f'Stress_Level_{v}.csv'), index_col=0)
        t.columns = [c.strip() for c in t.columns]
        for subj, row in t.iterrows():
            for phase, val in row.items():
                levels[(str(subj).strip(), phase)] = float(val)
    return levels


def per_subject_spearman(proba, ev, subjects, levels):
    """Within-person Spearman between mean predicted stress per phase and the
    self-reported stress for that phase (same rule as train.py)."""
    from scipy.stats import spearmanr
    st = ev[ev.protocol == 'STRESS'].copy()
    st['p'] = stress_vs_rest(proba[st.index])
    agg = st.groupby(['subject', 'phase']).p.mean().reset_index()
    agg['sl'] = [levels.get((s, ph), np.nan) for s, ph in zip(agg.subject, agg.phase)]
    agg = agg.dropna()
    out = np.full(len(subjects), np.nan)
    idx = {s: i for i, s in enumerate(subjects)}
    for s, g in agg.groupby('subject'):
        if g.sl.nunique() > 1 and len(g) >= 4:
            out[idx[s]] = spearmanr(g.p, g.sl).statistic
    return out


def summarize(proba, data, subjects=None, levels=None):
    """Headline metrics for one set of out-of-fold probabilities."""
    y, groups, ev = data['y'], data['groups'], data['ev']
    subjects = np.unique(groups) if subjects is None else subjects
    pred = proba.argmax(1)
    cms = subject_confusions(y, pred, groups, subjects)
    pooled = cms.sum(0)
    auc = per_subject_auc(proba, y, groups, ev, subjects)
    rec = np.diagonal(pooled) / pooled.sum(1)
    out = dict(balanced_accuracy=float(bacc_from_cm(pooled)), macro_f1=float(f1_from_cm(pooled)),
               per_subject_bacc=float(np.nanmean(bacc_from_cm(cms))),
               auc_per_subject=float(np.nanmean(auc)),
               recall_rest=float(rec[0]), recall_stress=float(rec[1]), recall_exercise=float(rec[2]))
    if levels is not None:
        out['spearman_within'] = float(np.nanmean(per_subject_spearman(proba, ev, subjects, levels)))
    return out
