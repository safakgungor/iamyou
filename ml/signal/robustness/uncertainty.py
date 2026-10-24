"""Subject-level uncertainty for the headline comparison.

  * bootstrap over subjects (10,000 reps): 95% percentile CIs for balanced accuracy,
    macro-F1, per-subject stress-vs-rest AUC (and per-subject balanced accuracy and the
    self-report Spearman) of every configuration, and for paired differences
  * sign-flip permutation test (100,000 flips) of hgb/personal_levels - hgb/population:
    for each subject, the two configurations' predictions are swapped or not
  * selection-aware max-T (Westfall-Young, sign flips) over the six "personal design vs
    population" comparisons (2 model families x 3 designs), two-sided
  * Holm correction of the twelve Wilcoxon p-values in out/results.json
The bootstrap resamples the people who are scored; the trained LOSO models are held
fixed, so the intervals describe test-set (subject) variation, not retraining noise.

Usage: python -I uncertainty.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np

from common import (CONFIGS, DESIGNS, KINDS, RES, SIGNAL, bacc_from_cm, f1_from_cm, load,
                    per_subject_auc, per_subject_spearman, self_report_levels,
                    subject_confusions)

B, P_FLIP, P_MAXT = 10_000, 100_000, 100_000
rng = np.random.default_rng(20261024)

data = load(os.path.join(SIGNAL, 'windows.csv'))
y, groups, ev = data['y'], data['groups'], data['ev']
subjects = np.unique(groups)
S = len(subjects)
lv = self_report_levels()

oof = {c: np.load(os.path.join(SIGNAL, 'out', 'oof.npz'))[c.replace('/', '_')] for c in CONFIGS}
nested_path = os.path.join(RES, 'nested_oof.npz')
if os.path.exists(nested_path):
    nz = np.load(nested_path)
    for k in ('hgb_design_by_bacc', 'any_config_by_bacc'):
        oof[f'nested/{k}'] = nz[k]

# per-subject building blocks
blocks = {}
for c, p in oof.items():
    cms = subject_confusions(y, p.argmax(1), groups, subjects)
    blocks[c] = dict(cm=cms, auc=per_subject_auc(p, y, groups, ev, subjects),
                     sbacc=bacc_from_cm(cms), rho=per_subject_spearman(p, ev, subjects, lv))
assert all(np.isfinite(b['auc']).all() for b in blocks.values())


def stats_from_weights(W, b):
    """Metrics for bootstrap weights W (reps x subjects) of one configuration."""
    cm = np.einsum('rs,sij->rij', W, b['cm'])
    rho_ok = np.isfinite(b['rho'])
    rho = (W[:, rho_ok] @ b['rho'][rho_ok]) / W[:, rho_ok].sum(1)
    return dict(balanced_accuracy=bacc_from_cm(cm), macro_f1=f1_from_cm(cm),
                auc_per_subject=(W @ b['auc']) / W.sum(1),
                per_subject_bacc=(W @ b['sbacc']) / W.sum(1), spearman_within=rho)


def point(b):
    return stats_from_weights(np.ones((1, S)), b)


idx = rng.integers(0, S, size=(B, S))
W = np.zeros((B, S))
np.add.at(W, (np.repeat(np.arange(B), S), idx.ravel()), 1)


def ci(v):
    lo, hi = np.nanpercentile(v, [2.5, 97.5])
    return [float(lo), float(hi)]


boot = {}
draws = {}
for c, b in blocks.items():
    pt = {k: float(v[0]) for k, v in point(b).items()}
    bs = stats_from_weights(W, b)
    draws[c] = bs
    boot[c] = {k: dict(estimate=pt[k], ci95=ci(bs[k])) for k in pt}

A, Bc = 'hgb/personal_levels', 'hgb/population'
pairs = [(A, Bc), ('logreg/personal_levels', 'logreg/population'), ('hgb/personal_levels', 'logreg/population')]
for k in ('nested/hgb_design_by_bacc', 'nested/any_config_by_bacc'):
    if k in blocks:
        pairs.append((k, Bc))
paired = {}
for a, b in pairs:
    pa, pb = point(blocks[a]), point(blocks[b])
    paired[f'{a} - {b}'] = {
        k: dict(estimate=float(pa[k][0] - pb[k][0]), ci95=ci(draws[a][k] - draws[b][k]),
                boot_share_le_0=float(np.mean(draws[a][k] - draws[b][k] <= 0)))
        for k in pa}

# ---- sign-flip permutation test, subject level ----
F = rng.integers(0, 2, size=(P_FLIP, S)).astype(float)


def flip_test(a, b):
    ba, bb = blocks[a], blocks[b]
    out = {}
    cma, cmb = ba['cm'].reshape(S, 9), bb['cm'].reshape(S, 9)
    pa = (F @ cmb + (1 - F) @ cma).reshape(-1, 3, 3)   # flipped subjects take b's predictions
    pb = (F @ cma + (1 - F) @ cmb).reshape(-1, 3, 3)
    for name, fn in (('balanced_accuracy', bacc_from_cm), ('macro_f1', f1_from_cm)):
        obs = fn(ba['cm'].sum(0)) - fn(bb['cm'].sum(0))
        null = fn(pa) - fn(pb)
        out[name] = dict(observed=float(obs), p_two_sided=float((np.sum(np.abs(null) >= abs(obs) - 1e-12) + 1) / (P_FLIP + 1)))
    for name, key in (('auc_per_subject', 'auc'), ('per_subject_bacc', 'sbacc'), ('spearman_within', 'rho')):
        dlt = ba[key] - bb[key]
        dlt = dlt[np.isfinite(dlt)]
        sg = 1 - 2 * F[:, :len(dlt)]
        null = (sg * dlt).mean(1)
        obs = dlt.mean()
        out[name] = dict(observed=float(obs), better=int((dlt > 0).sum()), n=int(len(dlt)),
                         p_two_sided=float((np.sum(np.abs(null) >= abs(obs) - 1e-12) + 1) / (P_FLIP + 1)))
    return out


perm = {f'{a} - {b}': flip_test(a, b) for a, b in pairs}

# ---- selection-aware max-T over the six personal-vs-population comparisons ----
# Westfall-Young single-step max-T with subject-level sign flips: one flip per subject
# is applied to all six "design - population" comparisons at once (for a flipped
# subject, each design swaps predictions with its family's population model). The
# largest |difference| across the six is recorded, so the adjusted p-value accounts for
# having looked at six comparisons and kept the best. Two-sided.
comparisons = [f'{k}/{d}' for k in KINDS for d in DESIGNS[1:]]
Fm = F[:P_MAXT]
maxt = {}
for metric in ('balanced_accuracy', 'macro_f1', 'auc_per_subject', 'per_subject_bacc'):
    null_max = np.zeros(P_MAXT)
    obs = {}
    for c in comparisons:
        pop = c.split('/')[0] + '/population'
        ba, bb = blocks[c], blocks[pop]
        if metric in ('balanced_accuracy', 'macro_f1'):
            fn = bacc_from_cm if metric == 'balanced_accuracy' else f1_from_cm
            cma, cmb = ba['cm'].reshape(S, 9), bb['cm'].reshape(S, 9)
            pa = (Fm @ cmb + (1 - Fm) @ cma).reshape(-1, 3, 3)
            pb = (Fm @ cma + (1 - Fm) @ cmb).reshape(-1, 3, 3)
            null = fn(pa) - fn(pb)
            obs[c] = float(fn(ba['cm'].sum(0)) - fn(bb['cm'].sum(0)))
        else:
            key = 'auc' if metric == 'auc_per_subject' else 'sbacc'
            dlt = ba[key] - bb[key]
            null = ((1 - 2 * Fm) * dlt).mean(1)
            obs[c] = float(dlt.mean())
        null_max = np.maximum(null_max, np.abs(null))
    maxt[metric] = {c: dict(diff=v, p_adjusted=float((np.sum(null_max >= abs(v) - 1e-12) + 1) / (P_MAXT + 1)))
                    for c, v in obs.items()}

# ---- Holm over the twelve Wilcoxon tests reported by train.py ----
tests = json.load(open(os.path.join(SIGNAL, 'out', 'results.json')))['tests']
names = sorted(tests, key=lambda t: tests[t]['wilcoxon_p'])
m = len(names)
holm, running = {}, 0.0
for i, t in enumerate(names):
    running = max(running, min(1.0, (m - i) * tests[t]['wilcoxon_p']))
    holm[t] = dict(p=tests[t]['wilcoxon_p'], p_holm=running)

out = dict(settings=dict(bootstrap_reps=B, sign_flips=P_FLIP, maxT_perms=P_MAXT, subjects=int(S),
                         windows=int(len(y))),
           bootstrap=boot, paired=paired, sign_flip=perm, max_t=maxt, holm_wilcoxon=holm)
json.dump(out, open(os.path.join(RES, 'uncertainty.json'), 'w'), indent=2)


def fmt(e, c):
    return f'{e:.3f} [{c[0]:.3f}, {c[1]:.3f}]'


for c in (Bc, A, 'nested/hgb_design_by_bacc', 'nested/any_config_by_bacc'):
    if c in boot:
        print(f'{c:30s}', '  '.join(f'{k} {fmt(v["estimate"], v["ci95"])}' for k, v in boot[c].items()))
for k, v in paired.items():
    print(k)
    for mtr, r in v.items():
        print(f'   {mtr:18s} {fmt(r["estimate"], r["ci95"])}  share<=0 {r["boot_share_le_0"]:.4f}  '
              f'sign-flip p {perm[k][mtr]["p_two_sided"]:.4f}')
print('max-T (two-sided, 6 comparisons, sign-flip):')
for mtr, v in maxt.items():
    print('  ', mtr, {c: (round(r['diff'], 3), round(r['p_adjusted'], 4)) for c, r in v.items()})
print('Holm:', {t: round(v['p_holm'], 4) for t, v in holm.items() if t.startswith('hgb/personal_levels')})
