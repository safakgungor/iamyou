# Requirements Document

## Introduction

The `health-baseline` feature is the opt-in health layer of iamyou. It derives
deterministic speech features from check-in transcripts, ingests wearable features and
the twin-accuracy trend, and builds a personal baseline from the user's own history —
never a population norm. When a deviation persists across enough features for long
enough, the feature raises a single change signal. Every signal passes through the
user's right-not-to-know setting before it can reach the user or the clinician summary.

The feature also ships Maya's reproducible synthetic history (ages 18 to 40), a Timeline
screen with per-feature charts and an age scrubber, and a county-level context card drawn
from an open CDC dataset. Pure logic lives in `lib/` with no I/O: `speech-features.ts`,
`fillers.ts`, `baseline.ts`, `signal.ts`, and `rtk-gate.ts`. Weekly feature rows persist
in Supabase with row-level security keyed on `auth.uid()`; Maya's rows are seeded only by
`POST /api/demo/start` using the service-role key.

All work in this spec obeys the non-negotiable rules in `AGENTS.md` and `.kiro/steering/`:
synthetic data only, never diagnose, the right-not-to-know gate, synthetic screens are
labelled, pure logic in `lib/` has no I/O, and secrets stay server-side.

## Glossary

- **System**: The iamyou `health-baseline` feature, comprising the Next.js client, its server routes, and the pure modules in `lib/`.
- **Demo_Service**: The server route `POST /api/demo/start` that seeds the caller's own rows using the Supabase service-role key.
- **Speech_Features**: The pure module `lib/speech-features.ts` that computes feature values from a transcript string with no model calls.
- **Fillers**: The ordered list of filler tokens in `lib/fillers.ts`: `um`, `uh`, `er`, `like`, `you know`, `i mean`, `basically`, `actually`.
- **Baseline_Module**: The pure module `lib/baseline.ts` that computes per-feature mean, standard deviation, and z-scores from prior weekly rows.
- **Signal_Module**: The pure module `lib/signal.ts` that detects a change signal and exports the detection constants.
- **RTK_Gate**: The pure function `gate(signal, setting)` in `lib/rtk-gate.ts` that returns `{showToUser, includeInSummary}`.
- **Weekly_Features_Table**: The Supabase table `weekly_features` holding one row per user per week.
- **Weekly_Feature_Repository**: The data-access interface over `weekly_features`, with an in-memory implementation used by tests.
- **Timeline_Screen**: The client screen that charts each feature with a baseline band and an age scrubber.
- **Context_Card**: The client card showing county-level short-sleep prevalence as population context.
- **token**: A whitespace-delimited, lowercased word unit extracted from a transcript.
- **sentence**: A transcript segment produced by splitting on the characters `.`, `!`, and `?`.
- **vocabularyDiversity**: The moving-average type-token ratio over a 50-token window; the plain type-token ratio for transcripts under 50 tokens. Range [0, 1].
- **meanSentenceLength**: The mean number of tokens per sentence.
- **fillerRate**: The number of filler tokens per 100 tokens; a value in [0, ∞).
- **type-token ratio**: The count of distinct tokens divided by the count of tokens.
- **feature**: One of `vocabulary_diversity`, `mean_sentence_length`, `filler_rate`, `sleep_hours`, `active_minutes`, or `twin_accuracy`.
- **z-score**: For a feature value `v` with prior mean `m` and standard deviation `sd`, `z = (v - m) / max(sd, 1e-6)`.
- **change signal**: A record stating that a persistent, multi-feature deviation was detected, listing the deviating features and the first week of the run.
- **rtk_setting**: The right-not-to-know setting; one of `tell_me`, `doctor_only`, or `record_only`.
- **User_Facing_Signal_Text**: The exact user-facing string "I've noticed some changes over the past few weeks. You might want to talk to your doctor about it."
- **Synthetic_Label**: A visible "Synthetic data" label shown on any screen that displays synthetic persona or history data.
- **BASELINE_WEEKS**: The constant `26`; the number of prior weeks used to compute a feature's mean and standard deviation.
- **MIN_BASELINE_WEEKS**: The constant `12`; the minimum number of prior weeks required before any z-score is computed.
- **Z_THRESHOLD**: The constant `2.0`; the absolute z-score at or above which a week counts as deviating for a feature.
- **WEEKS_REQUIRED**: The constant `3`; the number of consecutive deviating weeks required for a feature to qualify.
- **FEATURES_REQUIRED**: The constant `2`; the number of qualifying features required to raise a change signal.
- **ISO_week**: A calendar week identified by its `week_start` date (the Monday of the week).

## Requirements

### Requirement 1: Deterministic speech features

**User Story:** As a user with the health layer on, I want my speech features computed the same way every time from my words alone, so that the baseline reflects measurement, not a model's opinion.

#### Acceptance Criteria

1. THE Speech_Features module SHALL compute all feature values in `lib/speech-features.ts` from a transcript string, where tokens are the whitespace-delimited lowercased words of the transcript, without calling any model or performing any I/O.
2. IF a transcript has 50 or more tokens, THEN THE Speech_Features module SHALL compute `vocabularyDiversity` as the moving-average type-token ratio over a 50-token window.
3. IF a transcript has fewer than 50 tokens and 1 or more tokens, THEN THE Speech_Features module SHALL compute `vocabularyDiversity` as the plain type-token ratio of the transcript.
4. THE Speech_Features module SHALL compute `meanSentenceLength` as the mean number of tokens per sentence, where sentences are produced by splitting the transcript on the characters `.`, `!`, and `?`, and where empty segments produced by the split are excluded from the sentence count.
5. THE Speech_Features module SHALL compute `fillerRate` as the number of filler tokens per 100 tokens, counting only tokens listed in the Fillers module, and matching each multi-word filler (such as `you know`) against consecutive tokens before matching any single-word filler so that a token sequence is counted as at most one filler occurrence.
6. THE Fillers module SHALL define the filler tokens in `lib/fillers.ts` as `um`, `uh`, `er`, `like`, `you know`, `i mean`, `basically`, and `actually`.
7. IF a transcript yields zero tokens or zero non-empty sentences, THEN THE Speech_Features module SHALL return `vocabularyDiversity` as 0, `fillerRate` as 0, and `meanSentenceLength` as 0 without producing a division-by-zero error. _(Property P4)_
8. THE Speech_Features module SHALL constrain `vocabularyDiversity` to the inclusive range [0, 1] and `fillerRate` to values greater than or equal to 0 for all transcripts. _(Property P4)_
9. IF the same transcript string is provided to two separate computations, THEN THE Speech_Features module SHALL return identical feature values. _(Property P4)_

### Requirement 2: Weekly features table with row-level security

**User Story:** As a user, I want my weekly feature history stored privately under my own account, so that only I can read it and the demo persona's data stays separate.

#### Acceptance Criteria

1. THE System SHALL define the Weekly_Features_Table `weekly_features` with the columns `user_id`, `week_start`, `vocabulary_diversity`, `mean_sentence_length`, `filler_rate`, `sleep_hours`, `active_minutes`, `twin_accuracy`, and `synthetic`.
2. THE System SHALL enable row-level security on the Weekly_Features_Table.
3. THE System SHALL enforce uniqueness of `weekly_features` rows on the pair (`user_id`, `week_start`).
4. WHILE row-level security is enabled, THE System SHALL permit a user to read only `weekly_features` rows where `user_id = auth.uid()`.
5. WHILE row-level security is enabled, THE System SHALL permit a user to write only `weekly_features` rows where `user_id = auth.uid()`.
6. IF a user attempts to read or write a `weekly_features` row where `user_id` is not equal to `auth.uid()`, THEN THE System SHALL deny the operation.
7. WHEN the Demo_Service seeds Maya, THE Demo_Service SHALL insert one `weekly_features` row per entry in `data/synthetic/maya/weekly-features.json`, owned by the caller's `auth.uid()` and with `synthetic` set to `true`.
8. THE Demo_Service SHALL seed `weekly_features` only within the server route `POST /api/demo/start` using the Supabase service-role key.
9. THE System SHALL use the Supabase service-role key only within server code and SHALL NOT expose the service-role key to the client.
10. WHEN `POST /api/demo/start` is invoked more than once for the same caller, THE Demo_Service SHALL NOT create duplicate `weekly_features` rows for that caller.

### Requirement 3: Personal baseline and z-scores

**User Story:** As a user, I want each feature measured against my own recent history, so that a change is judged against me and never against a population average.

#### Acceptance Criteria

1. THE Baseline_Module SHALL compute, for each feature, the mean `m` and standard deviation `sd` over the weeks with available data within the `BASELINE_WEEKS` (26) weeks immediately preceding the week under evaluation.
2. WHERE the preceding window contains gaps, THE Baseline_Module SHALL compute `m` and `sd` using only the weeks that have data, excluding missing weeks from the count.
3. WHEN at least `MIN_BASELINE_WEEKS` (12) weeks of prior data exist for the week under evaluation, THE Baseline_Module SHALL compute the z-score for a feature value `v` as `z = (v - m) / max(sd, 1e-6)`, where `m` is the prior mean and `sd` is the prior standard deviation.
4. IF fewer than `MIN_BASELINE_WEEKS` (12) weeks of prior data exist for the week under evaluation, THEN THE Baseline_Module SHALL NOT produce a z-score value for that week.
5. IF the prior standard deviation `sd` is 0, THEN THE Baseline_Module SHALL divide by `1e-6` in place of `sd`, yielding a finite z-score.
6. THE Baseline_Module SHALL export `BASELINE_WEEKS` equal to 26 and `MIN_BASELINE_WEEKS` equal to 12 as named constants.
7. THE Baseline_Module SHALL compute all baseline values as pure logic in `lib/baseline.ts` without performing any I/O.

### Requirement 4: Change signal detection

**User Story:** As a user, I want one clear signal only when a change is real and sustained, so that I am not alarmed by a single unusual week.

#### Acceptance Criteria

1. THE Signal_Module SHALL export `Z_THRESHOLD` equal to 2.0, `WEEKS_REQUIRED` equal to 3, and `FEATURES_REQUIRED` equal to 2 as named constants in `lib/signal.ts`.
2. IF a feature has an absolute z-score greater than or equal to `Z_THRESHOLD` for at least `WEEKS_REQUIRED` consecutive weeks, where consecutive means adjacent weeks in the ordered weekly series with no gap between them and any missing week resets the consecutive count to zero, THEN THE Signal_Module SHALL treat that feature as qualifying.
3. WHEN at least `FEATURES_REQUIRED` features qualify, THE Signal_Module SHALL create exactly one change signal listing all qualifying features and the first week of the qualifying run, where the first week is the earliest week in which any qualifying feature begins a run that satisfies criterion 2.
4. IF a feature reaches or exceeds `Z_THRESHOLD` in a single week while every other week for that feature stays below `Z_THRESHOLD`, THEN THE Signal_Module SHALL NOT create a change signal from that feature alone. _(Property P1)_
5. IF fewer than `MIN_BASELINE_WEEKS` (12) weeks of data exist, THEN THE Signal_Module SHALL NOT create a change signal. _(Property P6)_
6. WHEN given two inputs that contain the same set of input rows in any order, THE Signal_Module SHALL produce change signal results with an identical set of qualifying features and an identical first week. _(Property P5)_
7. THE Signal_Module SHALL compute all detection as pure logic in `lib/signal.ts` without performing any I/O.

### Requirement 5: Right-not-to-know gate

**User Story:** As a user, I want full control over whether a change is shown to me or only to my clinician, so that my right not to know is always honoured.

#### Acceptance Criteria

1. THE RTK_Gate SHALL expose `gate(signal, setting)` in `lib/rtk-gate.ts` returning an object `{showToUser, includeInSummary}` as pure logic without performing any I/O.
2. WHEN `setting` is `tell_me`, THE RTK_Gate SHALL return `showToUser` equal to `true` and `includeInSummary` equal to `true`.
3. WHEN `setting` is `doctor_only`, THE RTK_Gate SHALL return `showToUser` equal to `false` and `includeInSummary` equal to `true`. _(Property P3)_
4. WHEN `setting` is `record_only`, THE RTK_Gate SHALL return `showToUser` equal to `false` and `includeInSummary` equal to `false`. _(Property P2)_
5. IF `setting` is any value other than `tell_me`, `doctor_only`, or `record_only` (including null, undefined, or an empty value), THEN THE RTK_Gate SHALL return `showToUser` equal to `false` and `includeInSummary` equal to `false`.
6. WHERE any UI path displays a change signal to the user, THE System SHALL call `gate()` and SHALL display the signal only when `gate().showToUser` is `true`.
7. WHERE any UI path evaluates a change signal and `gate().showToUser` is `false`, THE System SHALL NOT render the signal, its text, or any visual indicator of it to the user.
8. WHERE the System displays a change signal to the user, THE System SHALL use exactly the User_Facing_Signal_Text "I've noticed some changes over the past few weeks. You might want to talk to your doctor about it." with no additional, substituted, or omitted characters.
9. THE System SHALL NOT state or imply in any user-facing copy or model prompt that the user has, or is likely to have, any medical condition.

### Requirement 6: Reproducible synthetic history for Maya

**User Story:** As a judge, I want Maya's 18-to-40 history to be reproducible and to show a change signal late in the timeline, so that the demo tells a consistent, believable story.

#### Acceptance Criteria

1. WHEN `scripts/generate-maya.ts` runs, THE script SHALL write `data/synthetic/maya/weekly-features.json` using a seeded pseudo-random generator that depends only on a fixed seed and not on system time, locale, or environment.
2. WHEN `scripts/generate-maya.ts` runs more than once, THE script SHALL produce byte-for-byte identical output across runs and machines.
3. THE script SHALL write exactly one row per 7-day week spanning from the `start_date` (2026-10-24, age 18) to the `simulated_through` date (2048-10-24, age 40) in `data/synthetic/maya/profile.json`, inclusive of both endpoints.
4. WHILE Maya's simulated age is below 38.5, THE script SHALL keep each feature value within a small bounded deviation of Maya's baseline for that feature.
5. WHERE Maya's simulated age is at or above 38.5, THE script SHALL drift `vocabulary_diversity`, `sleep_hours`, and `twin_accuracy` monotonically downward relative to baseline and drift `filler_rate` monotonically upward relative to baseline, such that the deviation at `simulated_through` exceeds the deviation at age 38.5.
6. THE script SHALL produce feature values such that the Signal_Module first creates a change signal when Maya's simulated age is between 39 and 40.
7. IF Maya's simulated age is below 39, THEN THE script SHALL produce feature values that do not cause the Signal_Module to create a change signal.
8. WHEN the script writes a row, THE script SHALL set that row's `synthetic` value to `true`.

### Requirement 7: Timeline screen

**User Story:** As a user, I want to see each feature over time against my baseline and control whether a signal is shown, so that I can explore my history and my right-not-to-know setting in one place.

#### Acceptance Criteria

1. WHILE the Timeline_Screen is displayed, THE Timeline_Screen SHALL render one line chart per feature for each of `vocabulary_diversity`, `mean_sentence_length`, `filler_rate`, `sleep_hours`, `active_minutes`, and `twin_accuracy`.
2. FOR each feature chart, THE Timeline_Screen SHALL render a baseline band spanning the feature mean plus or minus two standard deviations.
3. THE Timeline_Screen SHALL provide an age scrubber with a minimum of 18 and a maximum of 40, inclusive.
4. WHILE `gate().showToUser` is `true` for the change signal, THE Timeline_Screen SHALL render a signal marker.
5. WHILE `gate().showToUser` is `false` for the change signal, THE Timeline_Screen SHALL NOT render a signal marker.
6. THE Timeline_Screen SHALL provide a control that changes the user's `rtk_setting`.
7. WHEN the user changes `rtk_setting` to a value for which `gate().showToUser` is `false`, THE Timeline_Screen SHALL remove the signal marker.
8. WHILE the Timeline_Screen is displayed, THE Timeline_Screen SHALL display a visible Synthetic_Label reading "Synthetic data".

### Requirement 8: County context card

**User Story:** As a user, I want to see how common short sleep is in my county, so that I have population context without being judged about my own sleep.

#### Acceptance Criteria

1. WHEN the Context_Card is displayed, THE Context_Card SHALL read the short-sleep prevalence for the county whose name exactly matches the county named in the user's profile from `data/public/cdc-places-short-sleep-ma-2022.csv`.
2. WHERE the user is Maya, THE Context_Card SHALL use the county `Hampshire`.
3. WHEN a matching county row is found, THE Context_Card SHALL display the prevalence value from that row as the percentage share of adults in that county who sleep under 7 hours.
4. THE Context_Card SHALL present the prevalence as population context only and SHALL NOT present the prevalence as a judgement about the user.
5. THE Context_Card SHALL NOT state or imply that the user has, or is likely to have, any medical condition.
6. THE Context_Card SHALL NOT compare, relate, or reference the user's own sleep against the displayed county prevalence figure.
7. IF the county named in the user's profile is not found in `data/public/cdc-places-short-sleep-ma-2022.csv`, THEN THE Context_Card SHALL NOT display a prevalence value and SHALL show an indication that county context is unavailable.

## Correctness Properties

These properties are carried into design and verified with fast-check. Each is attached to
the requirement(s) it governs.

- **P1 — A single spike never signals.** For any history where exactly one week reaches `|z| >= Z_THRESHOLD` while every other week stays below `Z_THRESHOLD`, the Signal_Module produces no change signal. _(Requirement 4)_
- **P2 — `record_only` hides everywhere.** For any signal, `gate(signal, "record_only")` returns `showToUser` equal to `false` and `includeInSummary` equal to `false`. _(Requirement 5)_
- **P3 — `doctor_only` hides from the user.** For any signal, `gate(signal, "doctor_only").showToUser` is `false`. _(Requirement 5)_
- **P4 — Speech features are deterministic and bounded.** For any transcript, the speech features are identical across repeated computations, `vocabularyDiversity` is within [0, 1], and `fillerRate` is greater than or equal to 0. _(Requirement 1)_
- **P5 — Detection is order-independent.** For any set of input rows, signal detection returns the same result regardless of the ordering of those rows. _(Requirement 4)_
- **P6 — Not enough history, no signal.** For any history with fewer than `MIN_BASELINE_WEEKS` weeks of data, the Signal_Module produces no change signal. _(Requirement 4)_

## Out of Scope

The following are explicitly out of scope for the `health-baseline` spec and are handled by other specs:

- The core predict-and-correct loop, the vault, voice check-in, and the session score (covered by `twin-loop`). This spec consumes the twin-accuracy trend as a feature but does not produce it.
- Email drafting and the assistant inbox (covered by `assistant-tasks`).
- The clinician summary, the trial finder, and family mode (covered by `care-outputs`). This spec defines how a signal is gated into the summary via `includeInSummary` but does not render the summary.
