# Requirements Document

## Introduction

The `twin-loop` feature is the core of iamyou: a voice-first predict-and-correct loop
in which a digital twin predicts a user's answer to a check-in prompt before seeing it,
grades the prediction against the real answer, and learns from a one-sentence correction.
It covers the demo mode ("Try as Maya"), onboarding and consent, the per-user vault and
its data model, the voice check-in loop, Claude-graded scoring, corrections, and the
session score with a weekly trend.

The feature is a Next.js (App Router, TypeScript) PWA deployed on Vercel. Persistence is
Supabase Postgres with row-level security and Supabase Auth, including anonymous sign-in
for the demo. Claude (Anthropic API) is called only from server routes. Speech-to-text and
text-to-speech run in the phone browser via the Web Speech API and `speechSynthesis`.
Tests are written with Vitest and property-based tests with fast-check.

All work in this spec obeys the non-negotiable rules in `AGENTS.md` and `.kiro/steering/`:
synthetic data only, never diagnose, the right-not-to-know gate, nothing sent without
approval, synthetic screens are labelled, and secrets stay server-side.

## Glossary

- **System**: The iamyou twin-loop application, comprising the Next.js client and its server routes.
- **Demo_Service**: The server route `POST /api/demo/start` that signs a visitor in anonymously and seeds that user's rows from Maya's synthetic data using the service-role key.
- **Onboarding_Service**: The part of the System that captures a new user's consent and settings during first use.
- **Vault**: The collection of per-user tables — `profiles`, `vault_entries`, `predictions`, and `answers` — protected by row-level security.
- **Vault_Repository**: The data-access interface over the Vault tables, with an in-memory implementation used by tests.
- **Check_In_Service**: The part of the System that presents check-in prompts and orchestrates prediction, answering, and grading.
- **Prediction_Service**: The server route that asks Claude to predict a user's answer to a prompt from vault context, without the answer as input.
- **Grading_Service**: The server route that asks Claude to grade a stored prediction against the user's submitted answer.
- **Voice_Service**: The browser-side speech-to-text and text-to-speech capability (Web Speech API `SpeechRecognition` / `webkitSpeechRecognition` and `speechSynthesis`).
- **Score_Service**: The part of the System that computes the clamped grade, the session score, and the weekly trend.
- **family_history**: A profile field; one of `huntington`, `familial_alzheimers`, `als`, `none`, or `prefer_not`.
- **health_layer_opt_in**: A boolean profile setting; default `false`.
- **rtk_setting**: The right-not-to-know setting; one of `tell_me`, `doctor_only`, or `record_only`; default `record_only`.
- **vault_entry kind**: The classification of a vault entry; one of `conversation`, `correction`, `story`, `opinion`, or `style_example`.
- **ISO_week**: A calendar week identified by its ISO-8601 year and week number (for example `2026-W45`).
- **clampScore**: The pure function that maps a raw numeric grade into the range [0, 1], mapping `NaN` to 0.
- **buildPredictionRequest**: The pure function that assembles a prediction request from a prompt and vault context, taking no answer parameter.
- **weeklyTrend**: The pure function that computes the mean score per ISO week from a set of graded answers.
- **deleteVault**: The operation that removes every row owned by a given user across all Vault tables.
- **Synthetic_Label**: A visible "Synthetic data" label shown on any screen that displays synthetic persona or history data.
- **crisis flag**: The boolean `crisis` field on a grading result; `true` when the user's answer expresses intent to harm oneself or a crisis that needs immediate support.
- **genetics_question flag**: The boolean `genetics_question` field on a grading result; `true` when the user's answer asks about genetic testing or a test result.
- **Support_Message**: A supportive message pointing the user to professional support, including the 988 Suicide & Crisis Lifeline (call or text 988 in the US).
- **Counselor_Message**: A message suggesting the user talk to a genetic counselor, which never interprets any test result.

## Requirements

### Requirement 1: Demo mode ("Try as Maya")

**User Story:** As a visitor with no account, I want to try the twin as Maya with one tap, so that I can experience the loop immediately without signing up.

#### Acceptance Criteria

1. WHEN a visitor taps "Try as Maya", THE Demo_Service SHALL sign the visitor in anonymously through Supabase Auth without requesting an email address.
2. WHEN anonymous sign-in succeeds, THE Demo_Service SHALL copy Maya's seed data from `data/synthetic/maya/profile.json` and `data/synthetic/maya/vault-entries.json` into Vault rows owned by the anonymous user's `auth.uid()`.
3. THE Demo_Service SHALL perform all seeding server-side in `POST /api/demo/start` using the Supabase service-role key.
4. THE System SHALL use the Supabase service-role key only within server code and SHALL NOT expose the service-role key to the client.
5. WHERE a screen displays Maya's persona data or synthetic vault history, THE System SHALL display a visible Synthetic_Label reading "Synthetic data".
6. IF the Demo_Service fails to seed the anonymous user's rows, THEN THE System SHALL display an error message and SHALL NOT present a partially seeded session as a complete demo.
7. WHEN the Demo_Service seeds the anonymous user, THE Demo_Service SHALL set that user's `rtk_setting` to `tell_me` and `health_layer_opt_in` to `true`, matching Maya's seed.

### Requirement 2: Onboarding and consent for new users

**User Story:** As a new user, I want to set my family-history context and privacy preferences before using the twin, so that the System behaves according to my choices.

#### Acceptance Criteria

1. WHEN a new user completes onboarding, THE Onboarding_Service SHALL store `family_history` as exactly one of `huntington`, `familial_alzheimers`, `als`, `none`, or `prefer_not`.
2. WHERE the user does not change the health-layer option, THE Onboarding_Service SHALL store `health_layer_opt_in` as `false`.
3. WHEN a new user completes onboarding, THE Onboarding_Service SHALL store `rtk_setting` as exactly one of `tell_me`, `doctor_only`, or `record_only`.
4. WHERE the user does not change the right-not-to-know option, THE Onboarding_Service SHALL store `rtk_setting` as `record_only`.
5. THE Onboarding_Service SHALL present a placeholder control for a digital-will setting.
6. THE Onboarding_Service SHALL NOT state or imply that the user has, or is likely to have, any medical condition.
7. WHERE onboarding surfaces health-related guidance, THE Onboarding_Service SHALL limit the strongest wording to "You might want to talk to your doctor about this."

### Requirement 3: Vault and data model with row-level security

**User Story:** As a user, I want my data isolated to my account and fully deletable, so that I stay in control of everything the twin stores about me.

#### Acceptance Criteria

1. THE System SHALL define the Vault tables `profiles`, `vault_entries`, `predictions`, and `answers`, each with a `user_id` column.
2. THE System SHALL store each `vault_entries` row with a `kind` equal to exactly one of `conversation`, `correction`, `story`, `opinion`, or `style_example`.
3. WHERE row-level security is applied, THE System SHALL permit a user to read only rows where `user_id = auth.uid()`.
4. WHERE row-level security is applied, THE System SHALL permit a user to write only rows where `user_id = auth.uid()`.
5. WHEN a user invokes the one-tap delete, THE Vault_Repository SHALL remove every row owned by that user across `profiles`, `vault_entries`, `predictions`, and `answers`.
6. WHEN `deleteVault(userId)` completes, THE Vault_Repository SHALL leave zero rows owned by `userId` in each of `profiles`, `vault_entries`, `predictions`, and `answers`. _(Property P4)_

### Requirement 4: Check-in loop with prediction before answer

**User Story:** As a user, I want the twin to predict my answer before I give it, so that the score honestly reflects how well the twin knows me.

#### Acceptance Criteria

1. THE Check_In_Service SHALL draw check-in prompts from `data/synthetic/checkin-prompts.json`, which contains exactly 20 prompts.
2. WHEN a prompt is shown to the user, THE Check_In_Service SHALL generate the twin's prediction for that prompt and store it in the `predictions` table before the user submits an answer.
3. THE Prediction_Service SHALL build the prediction request through `buildPredictionRequest`, which accepts a prompt and vault context and SHALL NOT accept an answer parameter.
4. WHERE an answer string is absent from the vault context, THE serialized prediction request produced by `buildPredictionRequest` SHALL NOT contain that answer string. _(Property P2)_
5. THE System SHALL NOT display the twin's prediction to the user before the user submits an answer.
6. THE Prediction_Service SHALL call Claude only from a server route.

### Requirement 5: Voice input and output with text fallback

**User Story:** As a user on my phone, I want to speak my answers and hear the twin reply, so that the loop is hands-free, with a reliable fallback when voice is unavailable.

#### Acceptance Criteria

1. WHERE the browser supports speech recognition, THE Voice_Service SHALL transcribe the user's spoken answer using the Web Speech API in the phone browser.
2. THE Voice_Service SHALL speak the twin's reply using the browser `speechSynthesis` capability.
3. IF speech recognition is unavailable in the browser, THEN THE Voice_Service SHALL show a text input fallback for entering the answer.

### Requirement 6: Grading the prediction against the answer

**User Story:** As a user, I want a fair, bounded score after I answer, so that I can trust what the number means and see why.

#### Acceptance Criteria

1. WHEN the user submits an answer, THE Grading_Service SHALL grade the stored prediction against the submitted answer using Claude, which returns an object of the form `{score: number, rationale: string, crisis: boolean, genetics_question: boolean}`, where `crisis` is `true` when the answer expresses intent to harm oneself or a crisis that needs immediate support, and `genetics_question` is `true` when the answer asks about genetic testing or a test result.
2. WHEN a raw score is received, THE Score_Service SHALL clamp the score to the range [0, 1] via `clampScore` and SHALL map `NaN` to 0.
3. FOR ALL numeric inputs `x`, `clampScore(x)` SHALL return a value within [0, 1], and `clampScore(NaN)` SHALL return 0. _(Property P1)_
4. WHEN the score has been clamped, THE Score_Service SHALL store the clamped score with the corresponding `answers` row.
5. WHEN the clamped score has been stored, THE Check_In_Service SHALL reveal the prediction, the clamped score, and a one-sentence spoken reply to the user.
6. THE Grading_Service SHALL call Claude only from a server route.
7. THE Grading_Service SHALL NOT state or imply that the user has, or is likely to have, any medical condition in the rationale or the spoken reply.

### Requirement 7: One-sentence correction

**User Story:** As a user, I want to correct the twin in one sentence, so that future predictions reflect what I just taught it.

#### Acceptance Criteria

1. THE System SHALL allow the user to add at most one correction sentence per check-in.
2. THE System SHALL limit a correction to a maximum of 280 characters.
3. IF the user adds a correction, THEN THE System SHALL store the correction as a `vault_entries` row with `kind` equal to `correction`.
4. WHERE a stored correction exists, THE Prediction_Service SHALL include that correction in the vault context used for future predictions.

### Requirement 8: Session score and weekly trend

**User Story:** As a user, I want to see this session's score and how the twin is tracking week over week, so that I can watch the twin learn me over time.

#### Acceptance Criteria

1. WHEN a check-in session ends, THE Score_Service SHALL display the session score derived from that session's clamped scores.
2. THE Score_Service SHALL compute the weekly trend as the mean clamped score per ISO_week via `weeklyTrend`.
3. FOR ALL inputs, `weeklyTrend` SHALL return exactly one value per ISO_week present in the input, and each returned value SHALL be within [0, 1]. _(Property P3)_

### Requirement 9: Crisis and genetics safety

**User Story:** As a user in distress or with a genetics question, I want the twin to step back and point me to real professional support, so that I am never left with a score, a twin reply, or an interpretation in place of appropriate help.

#### Acceptance Criteria

1. IF the grading result has `crisis` equal to `true`, THEN THE Check_In_Service SHALL show no score and no twin reply, and SHALL show the Support_Message pointing to professional support, including the 988 Suicide & Crisis Lifeline (call or text 988 in the US). _(Property P5)_
2. IF a correction expresses a crisis, THEN THE System SHALL show the Support_Message and SHALL NOT store anything in the Vault from that correction.
3. IF the grading result has `crisis` equal to `false` and `genetics_question` equal to `true`, THEN THE Check_In_Service SHALL show the clamped score and the prediction and SHALL replace the twin reply with the Counselor_Message, which suggests talking to a genetic counselor and SHALL NOT interpret any result.
4. IF a correction asks about genetic testing or a test result, THEN THE System SHALL show the Counselor_Message and SHALL NOT interpret any result.

## Correctness Properties

These properties are carried into design and verified with fast-check. Each is attached to
the requirement(s) it governs.

- **P1 — Score clamping.** For every number `x`, `clampScore(x)` is within [0, 1], and `clampScore(NaN)` is 0. _(Requirement 6)_
- **P2 — Prediction never sees the answer.** `buildPredictionRequest` takes no answer parameter; for any vault and any answer string absent from that vault, the serialized prediction request never contains that answer string. _(Requirements 4)_
- **P3 — Weekly trend shape and bounds.** `weeklyTrend` returns one value per ISO_week present in the input, and each value is within [0, 1]. _(Requirement 8)_
- **P4 — Delete leaves nothing.** `deleteVault(userId)` leaves zero rows for that user in every Vault table, verified against the in-memory Vault_Repository. _(Requirement 3)_
- **P5 — Crisis response.** For any grading result with crisis = true, the check-in result shown to the user contains the support message and contains no score, no prediction and no twin reply — regardless of the value of genetics_question. (When crisis = false and genetics_question = true, the result still shows the score and prediction and replaces the reply with the counselor message; this does not weaken the crisis guarantee.) _(Requirements 6, 9)_

## Out of Scope

The following are explicitly out of scope for the `twin-loop` spec and are handled by later specs:

- Email drafting and the assistant inbox (covered by `assistant-tasks`).
- Health and baseline features, including speech and wearable features, personal baseline, and change signals (covered by `health-baseline`).
- Care outputs: the clinician summary, the trial finder, and family mode (covered by `care-outputs`).
