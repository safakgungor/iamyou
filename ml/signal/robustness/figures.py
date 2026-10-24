"""Figures for the report (PNG, light background, slide-size type).

  fig_a_auc_per_subject.png   per-subject stress-vs-rest AUC, population vs personal_levels
  fig_b_confusion.png         row-normalized confusion matrix, hgb/personal_levels
  fig_c_timeline_S07.png      one stress session: heart rate + out-of-fold P(stress)
  fig_d_headline.png          headline metrics with subject-bootstrap 95% CIs

Usage: python -I figures.py
"""
import csv
import datetime as dt
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import LinearSegmentedColormap

from common import (CLASSES, RES, SIGNAL, load, per_subject_auc)

FIG = os.path.join(SIGNAL, 'figures')
os.makedirs(FIG, exist_ok=True)
INK, MUTED, CYAN, CYAN_INK = '#18212e', '#5a6a7e', '#36d1f0', '#0b86a8'
BG, GRID, FAINT = '#ffffff', '#e3e8ee', '#b8c2cd'
plt.rcParams.update({
    'font.family': 'sans-serif', 'font.sans-serif': ['Helvetica Neue', 'Helvetica', 'Arial'],
    'font.size': 15, 'axes.titlesize': 20, 'axes.labelsize': 15, 'xtick.labelsize': 13,
    'ytick.labelsize': 13, 'legend.fontsize': 14, 'text.color': INK, 'axes.labelcolor': MUTED,
    'xtick.color': MUTED, 'ytick.color': MUTED, 'axes.edgecolor': GRID, 'axes.linewidth': 1,
    'figure.facecolor': BG, 'axes.facecolor': BG, 'savefig.facecolor': BG, 'figure.dpi': 100,
    'axes.spines.top': False, 'axes.spines.right': False, 'axes.titlelocation': 'left',
    'axes.titleweight': 'bold', 'axes.titlepad': 14,
})
DPI = 200

data = load(os.path.join(SIGNAL, 'windows.csv'))
y, groups, ev = data['y'], data['groups'], data['ev']
subjects = np.unique(groups)
oof = np.load(os.path.join(SIGNAL, 'out', 'oof.npz'))
P_POP, P_PL = oof['hgb_population'], oof['hgb_personal_levels']
unc = json.load(open(os.path.join(RES, 'uncertainty.json')))


def subtitle(ax, text, y=1.02):
    ax.text(0, y, text, transform=ax.transAxes, color=MUTED, fontsize=14, va='bottom')


def header(fig, title, sub, x=0.07, y=0.96):
    fig.text(x, y, title, fontsize=22, fontweight='bold', color=INK, va='top')
    fig.text(x, y - 0.07, sub, fontsize=14, color=MUTED, va='top', linespacing=1.4)


def save(fig, name):
    path = os.path.join(FIG, name)
    fig.savefig(path, dpi=DPI)
    plt.close(fig)
    print('wrote', path)


# ---------------- (a) per-subject AUC, paired ----------------
auc_pop = per_subject_auc(P_POP, y, groups, ev, subjects)
auc_pl = per_subject_auc(P_PL, y, groups, ev, subjects)
diff = auc_pl - auc_pop
order = np.argsort(diff)
pd_ = unc['paired']['hgb/personal_levels - hgb/population']['auc_per_subject']
fig, ax = plt.subplots(figsize=(13.33, 7.0))
fig.subplots_adjust(left=0.07, right=0.98, top=0.82, bottom=0.14)
xs = np.arange(len(subjects))
for x, i in zip(xs, order):
    up = diff[i] > 0
    ax.plot([x, x], [auc_pop[i], auc_pl[i]], color=CYAN_INK if up else FAINT, lw=2.2,
            solid_capstyle='round', zorder=1)
ax.scatter(xs, auc_pop[order], s=70, color=MUTED, edgecolor=BG, linewidth=2, zorder=3,
           label='Population (raw features)')
ax.scatter(xs, auc_pl[order], s=90, color=CYAN, edgecolor=BG, linewidth=2, zorder=4,
           label='Personal baseline (personal_levels)')
ax.axhline(0.5, color=GRID, lw=1, zorder=0)
ax.text(-0.6, 0.505, 'chance', color=MUTED, fontsize=12, ha='left', va='bottom')
ax.set_xticks(xs)
ax.set_xticklabels(subjects[order], rotation=90, fontsize=11)
ax.set_xlim(-0.8, len(xs) - 0.2)
ax.set_ylim(0.25, 1.02)
ax.set_ylabel('Stress-vs-rest AUC (per person)')
ax.yaxis.grid(True, color=GRID, lw=1)
ax.set_axisbelow(True)
ax.spines['left'].set_visible(False)
ax.tick_params(axis='both', length=0)
n_up = int((diff > 0).sum())
header(fig, 'Judging each person against their own baseline',
       f'Better for {n_up} of {len(subjects)} people · mean AUC {auc_pop.mean():.3f} to {auc_pl.mean():.3f} '
       f'(+{pd_["estimate"]:.3f}, 95% CI {pd_["ci95"][0]:+.3f} to {pd_["ci95"][1]:+.3f}) · people sorted by change')
ax.legend(loc='lower left', frameon=False, ncol=1, handletextpad=0.3, borderaxespad=0.8)
fig.text(0.07, 0.02, 'Leave-one-subject-out, HistGradientBoosting. AUC ranks stress-task windows against seated-rest '
         'windows within each person\'s stress session.', color=MUTED, fontsize=11)
save(fig, 'fig_a_auc_per_subject.png')

# ---------------- (b) confusion matrix ----------------
pred = P_PL.argmax(1)
cm = np.zeros((3, 3))
np.add.at(cm, (y, pred), 1)
cmn = cm / cm.sum(1, keepdims=True)
cmap = LinearSegmentedColormap.from_list('cy', ['#f4fbfd', CYAN, CYAN_INK])
fig, ax = plt.subplots(figsize=(11, 8))
fig.subplots_adjust(left=0.2, right=0.9, top=0.80, bottom=0.15)
from matplotlib.patches import Rectangle
gap = 0.02
for i in range(3):
    for j in range(3):
        ax.add_patch(Rectangle((j - 0.5 + gap, i - 0.5 + gap), 1 - 2 * gap, 1 - 2 * gap,
                               color=cmap(cmn[i, j]), lw=0))
ax.set_xlim(-0.5, 2.5)
ax.set_ylim(2.5, -0.5)
ax.set_aspect('equal')
names = ['Rest', 'Stress task', 'Exercise']
for i in range(3):
    for j in range(3):
        v = cmn[i, j]
        col = BG if v > 0.55 else INK
        ax.text(j, i - 0.08, f'{v:.0%}', ha='center', va='center', fontsize=24, color=col, fontweight='bold')
        ax.text(j, i + 0.22, f'{int(cm[i, j]):,} windows', ha='center', va='center', fontsize=12,
                color=BG if v > 0.55 else MUTED)
ax.set_xticks(range(3))
ax.set_xticklabels(names, fontsize=15, color=INK)
ax.set_yticks(range(3))
ax.set_yticklabels(names, fontsize=15, color=INK)
ax.set_xlabel('Predicted', labelpad=10)
ax.set_ylabel('Protocol label', labelpad=10)
for s in ax.spines.values():
    s.set_visible(False)
ax.tick_params(length=0)
header(fig, 'Where the personal-baseline model is right and wrong',
       'Rows sum to 100% · 8,065 windows from 33 people, each scored by a model that never saw them',
       x=0.05)
fig.text(0.05, 0.03, 'hgb/personal_levels, leave-one-subject-out. Most errors are stress-task windows called rest.',
         color=MUTED, fontsize=11)
save(fig, 'fig_b_confusion.png')

# ---------------- (c) one person's stress session ----------------
SUBJ = 'S07'
d = os.path.join(SIGNAL, 'raw', 'Wearable_Dataset', 'STRESS', SUBJ)


def read_signal(path):
    with open(path) as f:
        rows = [r for r in csv.reader(f) if r]
    return dt.datetime.fromisoformat(rows[0][0].strip()), float(rows[1][0]), \
        np.array([float(r[0]) for r in rows[2:]])


eda_start, _, _ = read_signal(os.path.join(d, 'EDA.csv'))
hr_start, hr_fs, hr = read_signal(os.path.join(d, 'HR.csv'))
with open(os.path.join(d, 'tags.csv')) as f:
    tags = [eda_start] + [dt.datetime.fromisoformat(l.strip()) for l in f if l.strip()]
tsec = [(t - eda_start).total_seconds() for t in tags]
t0 = tsec[1]                                     # baseline start = time zero
hr_t = ((hr_start - eda_start).total_seconds() + np.arange(len(hr)) / hr_fs - t0) / 60
# V1 phase spans by tag index (same as build_windows.py)
stress_spans = [(3, 4, 'Stroop'), (5, 6, 'Mental\narithmetic'), (7, 8, ''), (9, 10, ''), (11, 12, '')]
rest_spans = [(4, 5, 'Rest'), (6, 7, 'Rest')]
m = (groups == SUBJ) & (ev.protocol == 'STRESS').to_numpy()
w_mid = (ev.t_start[m].to_numpy() + 15 - t0) / 60
p_st = P_PL[m, 1]
w_phase = ev.phase[m].to_numpy()
auc_s = auc_pl[list(subjects).index(SUBJ)]

fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(13.33, 7.5), sharex=True,
                               gridspec_kw=dict(height_ratios=[1.35, 1], hspace=0.12))
fig.subplots_adjust(left=0.08, right=0.98, top=0.80, bottom=0.11)
for ax in (ax1, ax2):
    ax.axvspan((tsec[2] - 180 - t0) / 60, (tsec[2] - t0) / 60, color=MUTED, alpha=0.10, lw=0)
    for i, j, _ in stress_spans:
        ax.axvspan((tsec[i] - t0) / 60, (tsec[j] - t0) / 60, color=CYAN, alpha=0.22, lw=0)
    ax.yaxis.grid(True, color=GRID, lw=1)
    ax.set_axisbelow(True)
    ax.spines['left'].set_visible(False)
    ax.tick_params(length=0)
xmax = (tsec[12] - t0) / 60 + 1.5
keep = (hr_t >= -0.5) & (hr_t <= xmax)
ax1.plot(hr_t[keep], hr[keep], color=INK, lw=2, solid_joinstyle='round')
ax1.set_ylabel('Heart rate (bpm)')
lo, hi = np.percentile(hr[keep], [1, 99.5])
ax1.set_ylim(lo - 8, hi + 14)
ytop = hi + 9
lab = dict(fontsize=12.5, color=INK, ha='center', va='bottom')
ax1.text(((tsec[2] - 90) - t0) / 60, ytop, 'Baseline\n(reference)', **{**lab, 'color': MUTED})
for i, j, name in stress_spans[:2] + rest_spans:
    if name:
        ax1.text(((tsec[i] + tsec[j]) / 2 - t0) / 60, ytop, name,
                 **{**lab, 'color': MUTED if name == 'Rest' else INK})
ax1.text(((tsec[7] + tsec[12]) / 2 - t0) / 60, ytop, 'Two speeches +\nsubtraction', **lab)
# out-of-fold probability, drawn per phase so unscored gaps stay empty
for ph in dict.fromkeys(w_phase):
    k = w_phase == ph
    ax2.plot(w_mid[k], p_st[k], color=CYAN_INK, lw=2, solid_capstyle='round', zorder=3)
    ax2.scatter(w_mid[k], p_st[k], s=36, color=CYAN_INK, edgecolor=BG, linewidth=1.5, zorder=4)
ax2.set_ylim(-0.03, 1.05)
ax2.set_yticks([0, 0.5, 1])
ax2.set_yticklabels(['0', '0.5', '1'])
ax2.set_ylabel('Model P(stress)')
ax2.set_xlabel('Minutes from start of baseline')
ax2.set_xlim(-0.5, xmax)
ax1.set_title(f'One person, one stress session ({SUBJ})', pad=58)
ax1.text(0, 1.06, f'Heart rate from the wristband (top) and the personal-baseline model\'s stress probability for '
         f'each 30 s window (bottom).\nThe model never saw {SUBJ} in training. Within-session stress-vs-rest '
         f'AUC {auc_s:.2f}.', transform=ax1.transAxes, color=MUTED, fontsize=13.5, va='bottom')
fig.text(0.08, 0.025, 'Shaded cyan: stress tasks · grey: seated baseline (used only as the reference, never scored) · '
         'unshaded gaps are instructions and transitions, not scored.', color=MUTED, fontsize=11)
save(fig, f'fig_c_timeline_{SUBJ}.png')

# ---------------- (d) headline metrics with bootstrap CIs ----------------
bs = unc['bootstrap']
series = [('hgb/population', 'Population', MUTED), ('hgb/personal_levels', 'Personal baseline', CYAN)]
if 'nested/any_config_by_bacc' in bs:
    series.append(('nested/any_config_by_bacc', 'Personal baseline, nested selection', CYAN_INK))
metrics = [('balanced_accuracy', 'Balanced accuracy\n(rest / stress / exercise)', 1 / 3),
           ('macro_f1', 'Macro-F1\n(rest / stress / exercise)', None),
           ('auc_per_subject', 'Stress-vs-rest AUC\n(mean per person)', 0.5)]
fig, ax = plt.subplots(figsize=(13.33, 7.0))
fig.subplots_adjust(left=0.07, right=0.98, top=0.76, bottom=0.17)
nb = len(series)
bw = 0.24
for gi, (mk, mname, chance) in enumerate(metrics):
    for si, (ck, sname, col) in enumerate(series):
        x = gi + (si - (nb - 1) / 2) * (bw + 0.035)
        e, (lo, hi) = bs[ck][mk]['estimate'], bs[ck][mk]['ci95']
        ax.bar(x, e, width=bw, color=col, zorder=2, label=sname if gi == 0 else None)
        ax.errorbar(x, e, yerr=[[e - lo], [hi - e]], fmt='none', ecolor=INK, elinewidth=1.6, capsize=6,
                    capthick=1.6, zorder=3)
        ax.text(x, hi + 0.015, f'{e:.3f}', ha='center', va='bottom', fontsize=14, color=INK, fontweight='bold')
        ax.text(x, hi + 0.058, f'[{lo:.2f}–{hi:.2f}]', ha='center', va='bottom', fontsize=10.5, color=MUTED)
ax.set_xticks(range(len(metrics)))
ax.set_xticklabels([m[1] for m in metrics], fontsize=14, color=INK)
ax.set_ylim(0, 1.04)
ax.set_yticks([0, 0.25, 0.5, 0.75, 1.0])
ax.yaxis.grid(True, color=GRID, lw=1)
ax.set_axisbelow(True)
ax.spines['left'].set_visible(False)
ax.tick_params(length=0)
ax.legend(loc='lower left', bbox_to_anchor=(0, 1.02), ncol=nb, frameon=False, borderaxespad=0,
          handlelength=1.2, columnspacing=1.8)
header(fig, 'Headline results, 33 people, leave-one-subject-out',
       'Bars: estimate · whiskers: 95% CI from resampling people (10,000 reps)')
fig.text(0.07, 0.025, 'HistGradientBoosting. Nested: feature design and model family re-chosen inside each outer fold '
         'from the training people only. Chance: balanced accuracy 0.33, AUC 0.50.', color=MUTED, fontsize=11)
save(fig, 'fig_d_headline.png')
