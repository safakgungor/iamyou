# Data

| Folder | Contents | In the public build |
| --- | --- | --- |
| `public/` | Open datasets from the Hackachusetts healthcare kit | Yes |
| `synthetic/` | Maya's persona and history, generated from a fixed seed | Yes |
| `private/` | Anything real (gitignored) | Never |

## Sources

- ClinicalTrials.gov API v2: studies recruiting with a Massachusetts site. U.S. government public data.
- CDC PLACES: Massachusetts county measures. U.S. government public data.
- PhysioNet wearable device dataset: check the dataset's license and access rules before adding it here.
- CMS care-update template: field structure for the clinician summary.

Files are taken from the [Hackachusetts 2026 healthcare portal](https://hackachusetts2026.vercel.app/#/healthcare). Each file added to `public/` gets a line here with its source and download date.
