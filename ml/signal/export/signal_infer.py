"""Pure-Python inference for signal-model.json (standard library only).

    model = load_model('signal-model.json')
    p = classify_window(model, window, baseline)   # {'rest': .., 'stress': .., 'exercise': ..}

window: dict with the 12 raw window features (see FEATURES in build_windows.py)
baseline: dict with hr_mean, eda_mean, temp_mean of the person's seated baseline
"""
import json
import math


def load_model(path):
    with open(path) as f:
        return json.load(f)


def personal_features(window, baseline, eda_eps=0.05):
    """The 12 model inputs in the documented order."""
    return [
        window['hr_mean'] - baseline['hr_mean'],
        math.log(window['eda_mean'] + eda_eps) - math.log(baseline['eda_mean'] + eda_eps),
        window['temp_mean'] - baseline['temp_mean'],
        window['hr_std'], window['hr_slope'],
        window['eda_std'], window['eda_slope'], window['eda_rise'],
        window['temp_slope'],
        window['acc_mean'], window['acc_std'], window['acc_jerk'],
    ]


def snap_features(x, scale=2.0 ** 30):
    """floor(x * scale + 0.5) / scale: exact IEEE arithmetic, identical to the TypeScript port."""
    return [math.floor(v * scale + 0.5) / scale if math.isfinite(v) else v for v in x]


def tree_value(tree, x):
    f, t, m, l, r = tree['f'], tree['t'], tree['m'], tree['l'], tree['r']
    node = 0
    while True:
        j = f[node]
        if j < 0:
            return t[node]
        v = x[j]
        go_left = (m[node] == 1) if math.isnan(v) else (v <= t[node])
        node = l[node] if go_left else r[node]


def raw_scores(model, x):
    if len(x) != len(model['features']['order']):
        raise ValueError('expected %d features' % len(model['features']['order']))
    x = snap_features(x, model['input_snap_scale'])
    raw = list(model['baseline_prediction'])
    for iteration in model['trees']:
        for k, tree in enumerate(iteration):
            raw[k] += tree_value(tree, x)
    return raw


def predict(model, x):
    """Softmax over the summed tree outputs, as sklearn's predict_proba."""
    raw = raw_scores(model, x)
    top = max(raw)
    e = [math.exp(z - top) for z in raw]
    s = 0.0
    for v in e:
        s += v
    return {c: e[k] / s for k, c in enumerate(model['classes'])}


def classify_window(model, window, baseline):
    return predict(model, personal_features(window, baseline, model['eda_eps']))
