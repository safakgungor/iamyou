# Data

| Folder | Contents | In the public build |
| --- | --- | --- |
| `public/` | Open datasets: the Hackachusetts healthcare kit and a PhysioNet stress sample | Yes |
| `synthetic/` | Maya's persona and history (see `synthetic/README.md`) | Yes |
| `private/` | Anything real (gitignored) | Never |

## Files in `public/`

The three kit files were saved by Hackachusetts on 2026-10-18 and downloaded from the [Hackachusetts 2026 healthcare portal](https://hackachusetts2026.vercel.app/#/healthcare) on 2026-10-24.

| File | Source | Rows | Columns | Notes |
| --- | --- | --- | --- | --- |
| `clinicaltrials-ma-recruiting-2026-10-18.csv` | ClinicalTrials.gov API v2, studies recruiting with a Massachusetts location. U.S. government public data. | 3,131 | nct_id, title, phase, conditions, massachusetts_city, status | Every row is RECRUITING and came from a Massachusetts-location query. `massachusetts_city` is empty in this export. |
| `cdc-places-ma-counties-2023.csv` | CDC PLACES 2023, crude prevalence, five adult measures. U.S. government public data. | 70 | year, county, measure, prevalence, low, high, population | County level, not individuals. |
| `cdc-places-short-sleep-ma-2022.csv` | CDC PLACES 2022, short sleep (under 7 hours), crude prevalence. U.S. government public data. | 14 | year, county, prevalence, low, high, population | A population survey, not wearable data. |
| `physionet-stress-v1-sample.json` | PhysioNet, Wearable Device Dataset from Induced Stress and Structured Exercise Sessions v1.0.1, STRESS protocol version 1. Open Data Commons Attribution License v1.0. | 17 participants | per participant: 8 protocol phases (start, end, mean HR, mean EDA, self-reported stress 1-10) and a 10-second HR/EDA series | Real, de-identified Empatica E4 recordings. S02 is excluded (duplicated signals). No demographics are included. Built from the original CSVs on 2026-10-24. |

## Other sources

- CMS ACCESS Model Care Update Template: field structure for the clinician summary (see `docs/clinician-summary-fields.md`).

## PhysioNet attribution

The PhysioNet sample is derived from:

> Hongn, A., Bosch, F., Prado, L., & Bonomini, P. (2025). Wearable Device Dataset from Induced Stress and Structured Exercise Sessions (version 1.0.1). PhysioNet. https://doi.org/10.13026/he0v-tf17

Original publication: Hongn, A., Bosch, F., Prado, L. E., Ferrández, J.M., & Bonomini, M. P. (2025). Wearable Physiological Signals under Acute Stress and Exercise Conditions. Scientific Data, 12(1). https://doi.org/10.1038/s41597-025-04845-9

Standard PhysioNet citation: Pollard, T., Moody, B. E., Lehman, L., Gow, B., Fernandes, C., Xie, C., Johnson, A., Mark, R. G., & Heldt, T. (2026). PhysioNet as a global platform for biomedical research. Nature Health. https://doi.org/10.1038/s44360-026-00096-z

Licensed under the [Open Data Commons Attribution License v1.0](https://physionet.org/content/wearable-device-dataset/view-license/1.0.1/). Phase boundaries follow the dataset notebook: tags 1-2 baseline, 3-4 Stroop, 4-5 first rest, 5-6 TMCT, 6-7 second rest, 7-8 real opinion, 9-10 opposite opinion, 11-12 subtraction.
