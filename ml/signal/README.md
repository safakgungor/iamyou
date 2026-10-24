# iamyou Signal: training pipeline

Trains the model in `data/public/signal-model.json`: rest, stress or exercise from a 30-second wrist window, judged against the person's own seated baseline. Results, limitations and how the app uses it: [`docs/signal-model.md`](../../docs/signal-model.md).

Data: PhysioNet, *Wearable Device Dataset from Induced Stress and Structured Exercise Sessions* v1.0.1, ODC-By, https://doi.org/10.13026/he0v-tf17. Real, de-identified research recordings; nothing from iamyou users. Downloads and every generated file stay in this folder and are gitignored.

## Setup

```bash
cd ml/signal
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python scripts/download.py raw          # ~160 MB from PhysioNet's AWS mirror, SHA256-checked
```

Run the analysis scripts with `-I` so nothing from the downloaded folders can be imported. HistGradientBoosting is single-threaded fast on this data; on a busy machine set `OMP_NUM_THREADS=1`.

## Pipeline

| Step | Command | Output |
|---|---|---|
| Windows and labels | `python -I scripts/build_windows.py raw/Wearable_Dataset windows.csv build.log` | `windows.csv` (8,694 windows, 34 people) |
| Population vs personal, LOSO | `python -I scripts/train.py windows.csv raw out` | `out/results.json`, `out/oof.npz` |
| Nested selection | `python -I robustness/nested.py` | `robustness/results/nested.json` |
| Bootstrap, permutation, max-T, Holm | `python -I robustness/uncertainty.py` | `robustness/results/uncertainty.json` |
| Sensitivity windows | `python -I robustness/build_windows_variant.py raw/Wearable_Dataset robustness/windows/w30_b120.csv robustness/windows/w30_b120.log 30 10 25 120` (also `w30_b60`: `30 10 25 60`, `w60_b180`: `60 10 50 180`) | `robustness/windows/*.csv` |
| Sensitivity runs | `python -I robustness/sensitivity.py` | `robustness/results/sensitivity.csv` |
| Figures | `python -I robustness/figures.py` | `figures/*.png` |
| Model size search | `python -I export/shrink_search.py windows.csv export/shrink_search.json` | `export/shrink_search.json` |
| Export | `python -I export/export_hgb.py windows.csv out/results.json export/shrink_search.json export/signal-model.json export/test-vectors.json export/oof.npz` | the shipped model and 30 test vectors |
| Demo data | `python -I demo/build_demo.py raw/Wearable_Dataset windows.csv export/signal-model.json demo/signal-demo.json demo/s07-stress-oof.json S10` | out-of-fold probabilities for S10 (stress and cycling) and S07 (stress) |

Copy the results into the app: `export/signal-model.json` → `data/public/signal-model.json`, `demo/signal-demo.json` → `data/public/signal-demo.json`, `demo/s07-stress-oof.json` → `data/public/signal-s07-stress.json`, `figures/*.png` → `docs/signal-model/`. Test vectors for the TypeScript port live in `ts/test-vectors.json`.

## TypeScript

`ts/signal-model.ts` runs the shipped trees with no dependencies (strict TypeScript, no imports). It is the source for the app's `lib/signal-model.ts`. Two checks run under Node 22 from the repository root:

```bash
node --experimental-strip-types ml/signal/ts/check.mts        # parity with scikit-learn on 30 vectors, and shift invariance
node --experimental-strip-types ml/signal/demo/check-demo.mts # sensible output on every demo window
```

`export/signal_infer.py` is a standard-library re-implementation of inference used to check the JSON against scikit-learn.
