# iamyou: product brief for Kiro specs

This brief is the input for Kiro's spec generation. Each section under "Specs" becomes one spec in `.kiro/specs/`. The rules in `AGENTS.md` apply to all of them.

## Context

- Hackachusetts 2026, Healthcare & Biotech track. Build time: 36 to 48 hours.
- Judges may only watch a demo video under 3 minutes and read the submission text. The demo link must work on a phone with no setup.

## Users

- **Primary:** adults (18+) with a parent who has Huntington's disease, familial Alzheimer's disease or ALS. They are reached through family history, never genotype.
- **Demo persona, Maya (synthetic):** started using iamyou at 18. Her father was diagnosed with early-onset familial Alzheimer's at 47. She has not had a genetic test. Health layer on; right-not-to-know setting `tell_me`.
- **Judges:** open the link on a phone, tap "Try as Maya" and finish the judge path in about two minutes.

## Judge path (must work end to end)

1. Open the link and tap "Try as Maya" (no login).
2. Voice check-in: the twin predicts Maya's answer, Maya corrects it, the similarity score updates.
3. Ask the assistant to draft an email to the doctor's office; approve or discard it.
4. Timeline: scrub from age 18 to 40, see the baseline, the drift and the change signal. Switch the right-not-to-know setting to `record_only` and see the signal disappear.
5. Open the clinician summary and the list of recruiting trials.

## Specs (build in this order)

### 1. twin-loop

Goal: the core loop works live, end to end, by hour 16.

- **Project setup:** Next.js with TypeScript and a PWA manifest, Supabase client, ready to deploy on Vercel. Demo mode "Try as Maya" loads seeded synthetic vault data without login.
- **Onboarding and consent:** family-history question (Huntington's disease, familial Alzheimer's, ALS, none, prefer not to say), health-layer opt-in, right-not-to-know setting, and a placeholder for a digital-will setting.
- **Vault:** per-user records (conversations, predictions, corrections, settings) in Supabase with row-level security. One-tap delete.
- **Voice check-in:** microphone in the phone browser, speech-to-text, Claude, text-to-speech. Text input as a fallback.
- **Predict and correct:** for each check-in prompt, the twin first predicts the user's answer without seeing it, then compares the prediction with the real answer. The user can correct the twin in one sentence; corrections are stored.
- **Similarity score:** 0 to 1 per session, graded by comparing prediction and answer, with a weekly trend.

Properties:

- The similarity score is always between 0 and 1.
- The prediction for a prompt is generated from inputs that never include that prompt's answer.
- After a vault delete, no record of that user can be read.

### 2. assistant-tasks

- A synthetic sample inbox that includes an email from a doctor's office.
- The twin drafts a reply in the user's voice, using style examples from the vault.
- Draft states: `draft`, `approved`, `sent` (simulated), `discarded`.

Properties:

- A draft can never reach `sent` without passing through `approved`.
- Drafting never changes the inbox.

### 3. health-baseline

- **Speech features,** computed in code from transcripts (deterministic, not by the model): vocabulary diversity (moving-average type-token ratio), mean sentence length, filler-word rate.
- **Wearable features:** sleep duration and daily activity, from the PhysioNet sample in `data/public/` and from Maya's synthetic series.
- **Twin accuracy** (the similarity score trend) is also a feature: a twin that stops predicting the user well is a signal.
- **Personal baseline:** a rolling window per feature; deviation measured against the user's own baseline, never a population norm.
- **Change signal:** triggers only when deviation persists for at least 3 weeks across at least 2 features. Both numbers are named constants.
- **Right-not-to-know gate:** every signal passes through `tell_me`, `doctor_only` or `record_only` (see `AGENTS.md`).
- **Timeline UI:** Maya's synthetic history from 18 to 40 with a scrubber, labelled "Synthetic data".

Properties:

- A single-day deviation never triggers a change signal.
- With `record_only`, no user-facing signal is produced for any input.
- With `doctor_only`, a signal appears only in the clinician summary.
- The same transcript always yields the same speech feature values.

### 4. care-outputs

- **Clinician summary:** one printable page structured on the fields of the CMS care-update template, stating clearly that it is not a diagnosis.
- **Trial finder:** recruiting studies with a Massachusetts site for the condition in the user's family, from the ClinicalTrials.gov API v2, with the saved slice in `data/public/` as an offline fallback. Shows condition, phase in plain language, city and a link to the study record.
- **Family mode:** a relative asks a question; the twin answers in the person's style using only vault entries and lists the entries it used.

Properties:

- The trial finder returns only studies with status RECRUITING and at least one Massachusetts location.
- A family-mode answer either cites at least one vault entry or says it does not know.

## Data

- `data/public/`: open datasets from the Hackachusetts healthcare kit (ClinicalTrials.gov Massachusetts recruiting slice, CDC PLACES, PhysioNet wearable sample), each with a source note.
- `data/synthetic/`: Maya's persona and history, generated by a script from a fixed seed so it is reproducible.
- `data/private/`: gitignored. Never used in the public build.

## UX

- Mobile first, usable with one hand, large tap targets.
- Voice first, with text as a fallback.
- Calm, warm visual tone. Health-related copy is reviewed by the team's medical member.

## Out of scope

Native mobile apps, real email or calendar integration, real patient or genetic data, EEG or other brain data, and any diagnostic claim.
