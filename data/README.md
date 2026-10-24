# Data

| Folder | Contents | In the public build |
| --- | --- | --- |
| `public/` | Open datasets from the Hackachusetts healthcare kit | Yes |
| `synthetic/` | Maya's persona and history (see `synthetic/README.md`) | Yes |
| `private/` | Anything real (gitignored) | Never |

## Files in `public/`

All three were saved by Hackachusetts on 2026-10-18 and downloaded from the [Hackachusetts 2026 healthcare portal](https://hackachusetts2026.vercel.app/#/healthcare) on 2026-10-24.

| File | Source | Rows | Columns | Notes |
| --- | --- | --- | --- | --- |
| `clinicaltrials-ma-recruiting-2026-10-18.csv` | ClinicalTrials.gov API v2, studies recruiting with a Massachusetts location. U.S. government public data. | 3,131 | nct_id, title, phase, conditions, massachusetts_city, status | Every row is RECRUITING and came from a Massachusetts-location query. `massachusetts_city` is empty in this export. |
| `cdc-places-ma-counties-2023.csv` | CDC PLACES 2023, crude prevalence, five adult measures. U.S. government public data. | 70 | year, county, measure, prevalence, low, high, population | County level, not individuals. |
| `cdc-places-short-sleep-ma-2022.csv` | CDC PLACES 2022, short sleep (under 7 hours), crude prevalence. U.S. government public data. | 14 | year, county, prevalence, low, high, population | A population survey, not wearable data. |

## Other sources

- CMS ACCESS Model Care Update Template: field structure for the clinician summary (see `docs/clinician-summary-fields.md`).
- PhysioNet wearable device dataset: not used yet; check its license and access rules before adding it here.
