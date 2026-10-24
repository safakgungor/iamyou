"""Copy of scripts/build_windows.py with the window length, hop, minimum length and
baseline length as arguments (robustness checks only; logic otherwise unchanged).

Usage: python -I build_windows_variant.py <Wearable_Dataset dir> <out.csv> <log.txt> \
           <window_s> <hop_s> <min_len_s> <baseline_s>

Labels come from the protocol tags (tags[k] is line k of tags.csv; tags[0] is
the recording start, as in the dataset notebook):
  baseline  last 180 s of the seated baseline (reference only, never scored)
  rest      seated rest between stress tasks
  stress    Stroop, mental arithmetic (TMCT), opinion speeches, subtraction
  exercise  cycling stages and sprints
Warm-ups, cool-downs, post-exercise rest and the gaps between tasks are not used.
"""
import csv
import datetime as dt
import os
import sys

import numpy as np

W, HOP, MIN_LEN = 30.0, 10.0, 25.0
BASELINE_S = 180.0

# (protocol, version) -> expected tags and phase spans as (start tag, end tag)
PROTOCOLS = {
    ('STRESS', 'V1'): dict(tags=12, baseline=(1, 2),
                           rest=[(4, 5), (6, 7)],
                           stress=[(3, 4), (5, 6), (7, 8), (9, 10), (11, 12)]),
    ('STRESS', 'V2'): dict(tags=9, baseline=(0, 1),
                           rest=[(3, 4), (7, 8)],
                           stress=[(2, 3), (4, 5), (6, 7), (8, 9)]),
    ('AEROBIC', 'V1'): dict(tags=12, exercise=[(1, 11)]),
    ('AEROBIC', 'V2'): dict(tags=8, exercise=[(1, 6)]),
    ('ANAEROBIC', 'V1'): dict(tags=7, exercise=[(1, 2), (3, 4), (5, 6)]),
    ('ANAEROBIC', 'V2'): dict(tags=11, exercise=[(2, 3), (4, 5), (6, 7), (8, 9)]),
}
STRESS_NAMES = {
    'V1': {(3, 4): 'Stroop', (5, 6): 'TMCT', (7, 8): 'Real Opinion',
           (9, 10): 'Opposite Opinion', (11, 12): 'Subtract',
           (4, 5): 'First Rest', (6, 7): 'Second Rest'},
    'V2': {(2, 3): 'TMCT', (4, 5): 'Real Opinion', (6, 7): 'Opposite Opinion',
           (8, 9): 'Subtract', (3, 4): 'First Rest', (7, 8): 'Second Rest'},
}
# Documented problems in data_constraints.txt
EXCLUDE = {
    ('STRESS', 'S02'),        # duplicated signals
    ('STRESS', 'f07'),        # PPG and temperature covered by the dock
    ('STRESS', 'f14_a'), ('STRESS', 'f14_b'),     # split recording
    ('AEROBIC', 'S11_a'), ('AEROBIC', 'S11_b'),   # split recording
    ('ANAEROBIC', 'S16_a'), ('ANAEROBIC', 'S16_b'),
    ('AEROBIC', 'S02'), ('ANAEROBIC', 'S02'),     # same participant as above
}

FEATURES = ['hr_mean', 'hr_std', 'hr_slope', 'eda_mean', 'eda_std', 'eda_slope',
            'eda_rise', 'temp_mean', 'temp_slope', 'acc_mean', 'acc_std', 'acc_jerk']


def parse_time(s):
    return dt.datetime.fromisoformat(s.strip())


def load_signal(path, cols=1):
    with open(path) as f:
        rows = [r for r in csv.reader(f) if r]
    start = parse_time(rows[0][0])
    fs = float(rows[1][0])
    vals = np.array([[float(x) for x in r[:cols]] for r in rows[2:]], dtype=float)
    return start, fs, vals


def slice_signal(sig, a, b):
    start, fs, vals = sig
    i = int(round((a - start).total_seconds() * fs))
    j = int(round((b - start).total_seconds() * fs))
    return vals[max(i, 0):max(j, 0)], fs


def slope(y, fs):
    if len(y) < 3:
        return np.nan
    t = np.arange(len(y)) / fs / 60.0  # per minute
    return float(np.polyfit(t, y, 1)[0])


def features(sigs, a, b):
    hr, fs_hr = slice_signal(sigs['HR'], a, b)
    eda, fs_eda = slice_signal(sigs['EDA'], a, b)
    temp, fs_t = slice_signal(sigs['TEMP'], a, b)
    acc, fs_a = slice_signal(sigs['ACC'], a, b)
    expect = (b - a).total_seconds()
    if (len(hr) < 0.8 * expect * fs_hr or len(eda) < 0.8 * expect * fs_eda
            or len(temp) < 0.8 * expect * fs_t or len(acc) < 0.8 * expect * fs_a):
        return None
    hr, eda, temp = hr[:, 0], eda[:, 0], temp[:, 0]
    mag = np.sqrt((acc ** 2).sum(axis=1)) / 64.0  # units of g
    return dict(
        hr_mean=hr.mean(), hr_std=hr.std(), hr_slope=slope(hr, fs_hr),
        eda_mean=eda.mean(), eda_std=eda.std(), eda_slope=slope(eda, fs_eda),
        eda_rise=float(np.clip(np.diff(eda), 0, None).sum()),
        temp_mean=temp.mean(), temp_slope=slope(temp, fs_t),
        acc_mean=mag.mean(), acc_std=mag.std(),
        acc_jerk=float(np.abs(np.diff(mag)).mean()) * fs_a,
    )


def windows(a, b):
    t = a
    while (b - t).total_seconds() >= MIN_LEN:
        e = min(t + dt.timedelta(seconds=W), b)
        yield t, e
        t += dt.timedelta(seconds=HOP)


def main(ROOT, OUT, LOG):
    out, log = [], []
    for proto in ('STRESS', 'AEROBIC', 'ANAEROBIC'):
        for folder in sorted(os.listdir(os.path.join(ROOT, proto))):
            d = os.path.join(ROOT, proto, folder)
            if not os.path.isdir(d):
                continue
            if (proto, folder) in EXCLUDE:
                log.append(f'skip {proto}/{folder}: data constraint')
                continue
            version = 'V1' if folder.startswith('S') else 'V2'
            spec = PROTOCOLS[(proto, version)]
            sigs = {k: load_signal(os.path.join(d, f'{k}.csv'), 3 if k == 'ACC' else 1)
                    for k in ('HR', 'EDA', 'TEMP', 'ACC')}
            with open(os.path.join(d, 'tags.csv')) as f:
                tag_lines = [parse_time(l) for l in f if l.strip()]
            if len(tag_lines) < spec['tags']:
                log.append(f'skip {proto}/{folder}: {len(tag_lines)} tags, expected {spec["tags"]}')
                continue
            tags = [sigs['EDA'][0]] + tag_lines
            subject = folder.split('_')[0]
            n = 0
            spans = []
            if 'baseline' in spec:
                end = tags[spec['baseline'][1]]
                spans.append(('baseline', 'Baseline', end - dt.timedelta(seconds=BASELINE_S), end))
            for label in ('rest', 'stress', 'exercise'):
                for (i, j) in spec.get(label, []):
                    name = STRESS_NAMES.get(version, {}).get((i, j), label) if proto == 'STRESS' else proto.title()
                    spans.append((label, name, tags[i], tags[j]))
            for label, name, a, b in spans:
                for wa, wb in windows(a, b):
                    f = features(sigs, wa, wb)
                    if f is None:
                        continue
                    out.append(dict(subject=subject, version=version, protocol=proto, label=label,
                                    phase=name, t_start=round((wa - tags[0]).total_seconds(), 1), **f))
                    n += 1
            log.append(f'ok   {proto}/{folder}: {len(tag_lines)} tags, {n} windows')
    with open(OUT, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=['subject', 'version', 'protocol', 'label', 'phase', 't_start'] + FEATURES)
        w.writeheader()
        for r in out:
            w.writerow(r)
    with open(LOG, 'w') as f:
        f.write('\n'.join(log) + '\n')
    print(len(out), 'windows')


if __name__ == '__main__':
    W, HOP, MIN_LEN, BASELINE_S = (float(x) for x in sys.argv[4:8])
    main(*sys.argv[1:4])
