"""Demo data for the in-app Signal chart: one person's full sessions, scored out of fold.

Usage: python -I build_demo.py <Wearable_Dataset dir> <windows.csv> <signal-model.json>
                               <out signal-demo.json> <out s07-stress-oof.json> [subject]

Every 30-second window (10 s hop) across the subject's STRESS and AEROBIC
version-1 sessions, with its 12 raw features, the protocol phases, and the
probabilities of a model trained WITHOUT that subject (same configuration as
the shipped model), so the chart is an honest preview of a new user.
The subject defaults to the one with complete STRESS and AEROBIC v1 sessions
(12 tags each) and the best out-of-fold stress-vs-rest AUC.

Also writes S07's STRESS session alone (out of fold, probabilities only) for the
landing-page chart, and checks the exported all-subjects JSON against sklearn
on these unseen session windows.
"""
import datetime as dt
import json
import os
import sys
import warnings

import numpy as np
from sklearn.metrics import roc_auc_score

SIGNAL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(SIGNAL, 'scripts'))
sys.path.insert(0, os.path.join(SIGNAL, 'export'))
from build_windows import EXCLUDE, FEATURES, features, load_signal, parse_time  # noqa: E402
from signal_common import CLASSES, FEATS, LEVELS, design, load, make_hgb  # noqa: E402
import signal_infer  # noqa: E402
import pandas as pd  # noqa: E402

warnings.filterwarnings('ignore', category=RuntimeWarning)
ROOT, WINDOWS, MODEL, OUT_DEMO, OUT_S07 = sys.argv[1:6]
SUBJECT = sys.argv[6] if len(sys.argv) > 6 else None
W, HOP = 30, 10
assert FEATS == FEATURES

model_json = signal_infer.load_model(MODEL)
params = {k: model_json['training']['params'][k] for k in ('max_iter', 'max_depth', 'learning_rate')}
if 'max_leaf_nodes' in model_json['training']['params']:
    params['max_leaf_nodes'] = model_json['training']['params']['max_leaf_nodes']

# Session layouts (tags[k] is line k of tags.csv; tags[0] is the recording start)
STRESS_V1 = dict(origin=1, phases=[
    (1, 2, 'Baseline', 'baseline'), (3, 4, 'Stroop', 'stress'), (4, 5, 'First Rest', 'rest'),
    (5, 6, 'TMCT', 'stress'), (6, 7, 'Second Rest', 'rest'), (7, 8, 'Real Opinion', 'stress'),
    (9, 10, 'Opposite Opinion', 'stress'), (11, 12, 'Subtract', 'stress')])
AEROBIC_V1 = dict(origin=0, phases=[(0, 1, 'Warm-up', 'warmup')] + [
    (i, i + 1, f'{rpm} rpm', 'exercise')
    for i, rpm in enumerate([60, 70, 75, 80, 85, 90, 95, 100, 105, 110], start=1)] + [
    (11, 12, 'Cool-down', 'recovery'), (12, None, 'Rest', 'rest')])
POST_REST_S = 120  # protocol: 2 min seated rest after the cool-down tag


def load_session(proto, subject):
    d = os.path.join(ROOT, proto, subject)
    sigs = {k: load_signal(os.path.join(d, f'{k}.csv'), 3 if k == 'ACC' else 1)
            for k in ('HR', 'EDA', 'TEMP', 'ACC')}
    with open(os.path.join(d, 'tags.csv')) as f:
        tags = [sigs['EDA'][0]] + [parse_time(l) for l in f if l.strip()]
    rec_end = min(start + dt.timedelta(seconds=len(vals) / fs) for start, fs, vals in sigs.values())
    return sigs, tags, rec_end


def complete_v1(subject):
    for proto, need in (('STRESS', 12), ('AEROBIC', 12)):
        d = os.path.join(ROOT, proto, subject)
        if (proto, subject) in EXCLUDE or not os.path.isdir(d):
            return False
        with open(os.path.join(d, 'tags.csv')) as f:
            if sum(1 for l in f if l.strip()) < need:
                return False
    return subject.startswith('S')


def session_windows(proto, subject):
    sigs, tags, rec_end = load_session(proto, subject)
    spec = STRESS_V1 if proto == 'STRESS' else AEROBIC_V1
    t0 = tags[spec['origin']]
    end = tags[-1] if proto == 'STRESS' else min(rec_end, tags[12] + dt.timedelta(seconds=POST_REST_S))
    rows, t = [], t0
    while (end - t).total_seconds() >= W:
        f = features(sigs, t, t + dt.timedelta(seconds=W))
        if f is not None:
            rows.append(dict(t=round((t - t0).total_seconds()), **{k: float(v) for k, v in f.items()}))
        t += dt.timedelta(seconds=HOP)
    rel = lambda x: round((x - t0).total_seconds())  # noqa: E731
    phases = [dict(name=name, kind=kind, start_s=rel(tags[a]), end_s=rel(tags[b] if b is not None else end))
              for a, b, name, kind in spec['phases']]
    return pd.DataFrame(rows), phases, rel(end)


d, ev, ref, refs, X, y, groups = load(WINDOWS)
fold_models = {}


def fold_model(subject):
    if subject not in fold_models:
        keep = groups != subject
        fold_models[subject] = make_hgb(**params).fit(X[keep], y[keep])
    return fold_models[subject]


def oof_auc(subject):
    m = groups == subject
    sr = m & (ev.protocol == 'STRESS').to_numpy() & (y != 2)
    p = fold_model(subject).predict_proba(X[sr])
    return roc_auc_score(y[sr] == 1, p[:, 1] / (p[:, 0] + p[:, 1] + 1e-12))


# Pick the demo subject: complete v1 sessions, clearest out-of-fold stress response
oof_path = os.path.join(SIGNAL, 'export', 'oof.npz')
if SUBJECT is None:
    oof = np.load(oof_path, allow_pickle=True)
    aucs = {}
    for s in sorted(set(groups)):
        if not complete_v1(s):
            continue
        m = (oof['subject'] == s) & (oof['protocol'] == 'STRESS') & (oof['label'] != 'exercise')
        p = oof['proba'][m]
        aucs[s] = roc_auc_score(oof['label'][m] == 'stress', p[:, 1] / (p[:, 0] + p[:, 1] + 1e-12))
    ranked = sorted(aucs.items(), key=lambda kv: -kv[1])
    print('complete v1 subjects by out-of-fold stress-vs-rest AUC:',
          ', '.join(f'{s} {a:.3f}' for s, a in ranked))
    SUBJECT = ranked[0][0]


def oof_proba(subject, frame):
    base = ref.loc[subject]
    refs_rows = pd.DataFrame([base[FEATS]] * len(frame)).reset_index(drop=True)
    return fold_model(subject).predict_proba(design(frame.reset_index(drop=True), refs_rows))


def check_fold(subject):
    """The fold model must reproduce the LOSO probabilities of export/oof.npz."""
    if not os.path.exists(oof_path):
        return None
    oof = np.load(oof_path, allow_pickle=True)
    m = groups == subject
    return float(np.abs(fold_model(subject).predict_proba(X[m]) - oof['proba'][oof['subject'] == subject]).max())


def r4(a):
    return [round(float(v), 4) for v in a]


def sig6(v):
    return float(f'{v:.6g}')


# signal-demo.json
full = make_hgb(**params).fit(X, y)  # the shipped all-subjects model, for the parity check only
parity_unseen = 0.0
out = dict(
    subject=SUBJECT,
    why=(f'Complete STRESS and AEROBIC v1 sessions and the clearest out-of-fold stress response '
         f'(stress-vs-rest AUC {oof_auc(SUBJECT):.3f}) among such subjects.'),
    model=f'{model_json["name"]} {model_json["version"]}',
    probabilities=('out of fold: from a model with the shipped configuration trained on the other '
                   f'{len(set(groups)) - 1} subjects, never on {SUBJECT}'),
    window_s=W, hop_s=HOP,
    baseline={k: float(ref.at[SUBJECT, k]) for k in LEVELS},
    baseline_note='mean of 30-s windows over the last 180 s of the seated baseline on the stress day',
    feature_order=FEATS,
    sessions={})
for proto in ('STRESS', 'AEROBIC'):
    frame, phases, duration = session_windows(proto, SUBJECT)
    p = oof_proba(SUBJECT, frame)
    # Parity of the rounded JSON on windows the export never saw
    refs_rows = pd.DataFrame([ref.loc[SUBJECT, FEATS]] * len(frame)).reset_index(drop=True)
    sk = full.predict_proba(design(frame, refs_rows))
    for i, row in frame.iterrows():
        q = signal_infer.classify_window(model_json, row.to_dict(), out['baseline'])
        parity_unseen = max(parity_unseen, max(abs(q[c] - sk[i, k]) for k, c in enumerate(CLASSES)))
    out['sessions'][proto.lower()] = dict(
        protocol=f'{proto} v1',
        origin='baseline tag (tags.csv line 1)' if proto == 'STRESS' else 'recording start (warm-up begins)',
        duration_s=duration, phases=phases,
        t=[int(v) for v in frame.t],
        features={f: [sig6(v) for v in frame[f]] for f in FEATS},
        oof={c: r4(p[:, k]) for k, c in enumerate(CLASSES)})
    print(f'{proto}: {len(frame)} windows, {duration} s')
text = json.dumps(out, separators=(',', ':'))
with open(OUT_DEMO, 'w') as f:
    f.write(text)
print(f'{OUT_DEMO}: {len(text) / 1024:.1f} KB; subject {SUBJECT}; fold check max diff {check_fold(SUBJECT)}; '
      f'exported JSON vs sklearn on unseen session windows: {parity_unseen:.2e}')

# s07-stress-oof.json
frame, phases, duration = session_windows('STRESS', 'S07')
p = oof_proba('S07', frame)
s07 = dict(
    subject='S07', session='STRESS v1', model=f'{model_json["name"]} {model_json["version"]}',
    probabilities='out of fold: model with the shipped configuration trained without S07',
    origin='baseline tag (tags.csv line 1); t is the window start in seconds from it',
    window_s=W, hop_s=HOP, duration_s=duration, phases=phases,
    windows=[dict(t=int(t), rest=round(float(a), 4), stress=round(float(b), 4), exercise=round(float(c), 4))
             for t, (a, b, c) in zip(frame.t, p)])
text = json.dumps(s07, separators=(',', ':'))
with open(OUT_S07, 'w') as f:
    f.write(text)
print(f'{OUT_S07}: {len(text) / 1024:.1f} KB; {len(frame)} windows; fold check max diff {check_fold("S07")}')
