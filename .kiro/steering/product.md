# Product

**iamyou** is a voice-first digital twin that grows with a person from age 18. It learns how someone thinks through a predict-and-correct loop, acts as an assistant that drafts in their voice, and — for adults with a family history of hereditary neurodegenerative disease (Huntington's, familial Alzheimer's, ALS) — builds a personal healthy baseline so that change can be noticed early and shared with a clinician.

Built for Hackachusetts 2026 (Healthcare & Biotech track). The deliverable is a mobile-first PWA that a judge can open on a phone with no setup and complete a ~2-minute "Try as Maya" demo path.

## Core loops

- **Predict and correct:** the twin predicts a user's answer to a check-in prompt before seeing it, the user corrects it in one sentence, and a 0–1 similarity score tracks how well the twin knows them.
- **Second self:** drafts messages (e.g. an email to a doctor's office) in the user's voice; nothing sends without explicit approval.
- **Health layer (opt-in):** derives speech and wearable features into a personal baseline; a persistent, multi-feature deviation raises a change signal, gated by the user's right-not-to-know setting.

## Non-negotiable rules

1. **Synthetic data only.** No real personal data in the repo, demo, or tests. Real data lives only in gitignored `data/private/` and is never read into commits, fixtures, or prompts.
2. **Never diagnose.** UI copy and model prompts never state a user has or is likely to have a condition. Strongest allowed wording: "You might want to talk to your doctor about this."
3. **Right not to know.** Every change signal passes through the user's setting — `tell_me`, `doctor_only`, or `record_only`. With `record_only`, nothing about a change is shown to the user; with `doctor_only`, it appears only in the clinician summary.
4. **Nothing is sent without approval.** The assistant only drafts; sending requires an explicit user action. A draft reaches `sent` only via `approved`.
5. **Label synthetic screens.** Any screen showing synthetic history or persona data shows a visible "Synthetic data" label.
6. **Crisis and genetics.** Crisis expressions get pointed to professional support; genetic-testing questions go to a genetic counselor. The twin never interprets a test result.

## Demo persona

**Maya** (synthetic): started at 18, father diagnosed with early-onset familial Alzheimer's at 47, no genetic test, health layer on, right-not-to-know set to `tell_me`. "Try as Maya" loads seeded synthetic vault data with no login.

## Out of scope

Native mobile apps, real email/calendar integration, real patient or genetic data, EEG/brain data, and any diagnostic claim.
