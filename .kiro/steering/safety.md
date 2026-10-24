---
inclusion: fileMatch
fileMatchPattern: ["app/**", "components/**", "lib/claude/**"]
---

# Safety checklist

Every UI string and every model prompt must pass this checklist. These restate the non-negotiable rules from `product.md`.

## Never diagnose (rule 2)

Copy and prompts never state a user has, or is likely to have, a condition.

- Allowed: "You might want to talk to your doctor about this."
- Forbidden: "This could be early Alzheimer's."

## Right not to know (rule 3)

Every change signal passes through the user's setting — `tell_me`, `doctor_only` or `record_only`.

- `record_only`: nothing about a change is ever shown to the user.
- `doctor_only`: the change appears only in the clinician summary, never in the user-facing UI.

## Label synthetic screens (rule 5)

Any screen showing synthetic history or persona data shows a visible "Synthetic data" label.

A screen showing the PhysioNet sample (`data/public/physionet-stress-v1-sample.json`) shows "Open research data · PhysioNet" with a link to the source. It is a research example, never presented as the user's own data.

## Crisis and genetics (rule 6)

- A user expressing crisis is pointed to professional support.
- Questions about genetic testing go to a genetic counselor; the twin never interprets a test result.
