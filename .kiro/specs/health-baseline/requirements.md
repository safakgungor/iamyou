# Requirements Document

## Introduction

The `health-baseline` feature is the opt-in health layer of iamyou. It derives
deterministic speech features from check-in transcripts, ingests wearable features and
the twin-accuracy trend, and builds a personal baseline from the user's own history —
never a population norm. The baseline is frozen, not rolling: it is seeded from the
user's first weeks of data and extended only with weeks that show no deviation, so a
slow drift is never absorbed into the reference. When a deviation persists across enough
features for long enough, the feature raises a single change signal. Every signal passes
through the user's right-not-to-know setting before it can reach the user or the
clinician summary. Nothing about the user's health history is shown before the user opts
in: the Timeline_Route first checks the caller's `health_layer_opt_in` and, when it is
not `true`, returns only `{ "opted_in": false }` without reading any weekly rows.

The feature also ships Maya's reproducible synthetic history (ages 18 to 40), a timeline
route and Timeline screen with per-feature charts and an age scrubber, and a county route
and context card drawn from an open CDC dataset; the county route is population context
and does not depend on the opt-in. Pure logic lives in `lib/` with no I/O:
`speech-features.ts`, `fillers.ts`, `baseline.ts`, `signal.ts`, and `weekly.ts`.
`lib/baseline.ts` and `lib/signal.ts` are exported for reuse by the `care-outputs` spec.
Weekly feature rows persist in Supabase with row-level security keyed on `auth.uid()`;
Maya's rows are seeded only by `POST /api/demo/start` using the service-role key. Route
request and response zod schemas live in `lib/api-schemas.ts`, and route logic lives in
exported functions that take repositories as arguments so it can be tested with
in-memory repositories, following the `twin-loop` and `assistant-tasks` specs.

All work in this spec obeys the non-negotiable rules in `AGENTS.md` and `.kiro/steering/`:
synthetic data only, never diagnose, the right-not-to-know gate, synthetic screens are
labelled, pure logic in `lib/` has no I/O, and secrets stay server-side.

## Glossary

- **System**: The iamyou `health-baseline` feature, comprising the Next.js client, its server routes, and the pure modules in `lib/`.
- **Demo_Service**: The server route `POST /api/demo/start` that seeds the caller's own rows using the Supabase service-role key.
- **Speech_Features**: The pure module `lib/speech-features.ts` exposing `extractSpeechFeatures(transcript)`, which computes feature values from a transcript string with no model calls.
- **Fillers**: The ordered list of filler tokens in `lib/fillers.ts`: `um`, `uh`, `er`, `like`, `you know`, `i mean`, `basically`, `actually`.
- **Baseline_Module**: The pure module `lib/baseline.ts` exposing `computeBaseline(rows)` and `zScores(rows)`, and defining the detection constants `Z_THRESHOLD`, `WEEKS_REQUIRED`, `FEATURES_REQUIRED`, and `MIN_BASELINE_WEEKS`.
- **Signal_Module**: The pure module `lib/signal.ts` exposing `detectSignal(rows)` and `gate(signal, rtk_setting)`, and re-exporting the detection constants from the Baseline_Module.
- **RTK_Gate**: The pure function `gate(signal, rtk_setting)` in `lib/signal.ts` that returns `{showToUser, includeInSummary}`. Every consumer imports `gate` only from `lib/signal.ts`; no other module re-exports or reimplements it.
- **health_layer_opt_in**: The boolean profile column `profiles.health_layer_opt_in`, default `false`, defined by the `twin-loop` migration; the health layer is on for a caller only when this value is `true`.
- **Weekly_Module**: The pure module `lib/weekly.ts` exposing `weeklySleepHours(dailyRows)`, which averages `sleep_hours` over the days of one week.
- **Weekly_Features_Table**: The Supabase table `weekly_features` holding one row per user per week.
- **Weekly_Feature_Repository**: The data-access interface over `weekly_features`, with an in-memory implementation used by tests.
- **Timeline_Route**: The authenticated server route `GET /api/timeline` that returns the caller's weekly rows, z-scores, baseline statistics, and the gated change signal.
- **County_Route**: The authenticated server route `GET /api/county` that returns the CDC PLACES short-sleep card values for the county in the caller's profile.
- **Timeline_Screen**: The client screen that charts each feature with a baseline band and an age scrubber.
- **Context_Card**: The client card showing county-level short-sleep prevalence as population context.
- **token**: A whitespace-delimited, lowercased word unit extracted from a transcript.
- **sentence**: A transcript segment produced by splitting on the characters `.`, `!`, and `?`.
- **vocabulary_diversity**: The speech feature equal to the moving-average type-token ratio over a 50-token window; the plain type-token ratio for transcripts under 50 tokens. Range [0, 1].
- **mean_sentence_length**: The speech feature equal to the mean number of tokens per sentence.
- **filler_rate**: The speech feature equal to the number of filler tokens per 100 tokens; a value in [0, ∞).
- **type-token ratio**: The count of distinct tokens divided by the count of tokens.
- **feature**: One of `vocabulary_diversity`, `mean_sentence_length`, `filler_rate`, `sleep_hours`, `active_minutes`, or `twin_accuracy`.
- **baseline set**: For one feature, the collection of that feature's non-null weekly values that the Baseline_Module uses as the reference for z-scores.
- **initial baseline set**: For one feature, the first `MIN_BASELINE_WEEKS` weeks, in `week_start` order, that have a non-null value for that feature.
- **population standard deviation**: The square root of the mean of squared differences from the mean, dividing by the count of values `n` (not `n - 1`).
- **z-score**: For a feature value `v` against a baseline set with mean `m` and population standard deviation `sd`, `z = (v - m) / max(sd, 1e-6)`.
- **deviating week**: A week in which a feature has a z-score with `|z| >= Z_THRESHOLD`.
- **change signal**: A record stating that a persistent, multi-feature deviation was detected, listing the deviating features and the first week of the run.
- **open change signal**: A change signal is open at week W when, at W or at some earlier week, at least `FEATURES_REQUIRED` features qualify at that same week under the detection condition of Requirement 4 (criteria 3 and 4, where consecutive weeks are exactly 7 days apart); once open, the change signal stays open for every later week in the series.
- **rtk_setting**: The right-not-to-know setting; one of `tell_me`, `doctor_only`, or `record_only`.
- **User_Facing_Signal_Text**: The exact user-facing string "I've noticed some changes over the past few weeks. You might want to talk to your doctor about it."
- **Synthetic_Label**: A visible "Synthetic data" label shown on any screen that displays synthetic persona or history data.
- **MIN_BASELINE_WEEKS**: The constant `12`; the size of each feature's initial baseline set, and the minimum number of non-null weeks required before any z-score is computed for that feature.
- **Z_THRESHOLD**: The constant `2.0`; the absolute z-score at or above which a week counts as deviating for a feature.
- **WEEKS_REQUIRED**: The constant `3`; the number of consecutive deviating weeks required for a feature to qualify.
- **FEATURES_REQUIRED**: The constant `2`; the number of qualifying features required to raise a change signal.
- **ISO_week**: A calendar week identified by its `week_start` date (the Monday of the week).

## Requirements

### Requirement 1: Deterministic speech features

**User Story:** As a user with the health layer on, I want my speech features computed the same way every time from my words alone, so that the baseline reflects measurement, not a model's opinion.

#### Acceptance Criteria

1. THE Speech_Features module SHALL expose `extractSpeechFeatures(transcript)` in `lib/speech-features.ts` returning an object with the snake_case keys `vocabulary_diversity`, `mean_sentence_length`, and `filler_rate`, computed from the transcript string, where tokens are the whitespace-delimited lowercased words of the transcript, without calling any model or performing any I/O.
2. IF a transcript has 50 or more tokens, THEN THE Speech_Features module SHALL compute `vocabulary_diversity` as the moving-average type-token ratio over a 50-token window.
3. IF a transcript has fewer than 50 tokens and 1 or more tokens, THEN THE Speech_Features module SHALL compute `vocabulary_diversity` as the plain type-token ratio of the transcript.
4. THE Speech_Features module SHALL compute `mean_sentence_length` as the mean number of tokens per sentence, where sentences are produced by splitting the transcript on the characters `.`, `!`, and `?`, and where empty segments produced by the split are excluded from the sentence count.
5. THE Speech_Features module SHALL compute `filler_rate` as the number of filler tokens per 100 tokens, counting only tokens listed in the Fillers module, and matching each multi-word filler (such as `you know`) against consecutive tokens before matching any single-word filler so that a token sequence is counted as at most one filler occurrence.
6. THE Fillers module SHALL define the filler tokens in `lib/fillers.ts` as `um`, `uh`, `er`, `like`, `you know`, `i mean`, `basically`, and `actually`.
7. IF a transcript yields zero tokens or zero non-empty sentences, THEN THE Speech_Features module SHALL return `vocabulary_diversity` as 0, `filler_rate` as 0, and `mean_sentence_length` as 0 without producing a division-by-zero error. _(Property P4)_
8. THE Speech_Features module SHALL constrain `vocabulary_diversity` to the inclusive range [0, 1] and `filler_rate` to values greater than or equal to 0 for all transcripts. _(Property P4)_
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
11. WHEN a user deletes their vault via the existing `deleteVaultForUser` in `app/api/vault/route.ts`, THE System SHALL also delete all of that user's `weekly_features` rows and SHALL leave every other user's `weekly_features` rows unchanged.

### Requirement 3: Frozen personal baseline and z-scores

**User Story:** As a user, I want each feature measured against a reference built from my own early, stable weeks, so that a change is judged against me, never against a population average, and a slow drift is never absorbed into the reference.

The baseline is frozen, not rolling: it grows only with weeks that show no deviation and stops growing once a change signal is open. The purpose of this rule is that a slow drift is never absorbed into the reference.

#### Acceptance Criteria

1. THE Baseline_Module SHALL expose `computeBaseline(rows)` and `zScores(rows)` in `lib/baseline.ts` as pure logic without performing any I/O, exported for reuse by the `care-outputs` spec.
2. WHEN `computeBaseline(rows)` or `zScores(rows)` is called, THE Baseline_Module SHALL evaluate the rows in a single chronological pass in ascending `week_start` order regardless of the order in which the rows are provided, completing for each week W, in this order, (a) the computation of W's z-scores, (b) the determination of whether a change signal is open at W, and (c) the decision whether to append W's values to any baseline set, before evaluating the next week, and SHALL return identical results for any two inputs that contain the same set of rows.
3. THE Baseline_Module SHALL form, for each feature, the initial baseline set from the first `MIN_BASELINE_WEEKS` (12) weeks, in `week_start` order, that have a non-null value for that feature, including each such week's value regardless of the z-scores of other features in that week and regardless of whether a change signal is open at that week.
4. IF a feature value is null or missing for a week, THEN THE Baseline_Module SHALL exclude that week from the feature's baseline set and z-scores, and SHALL NOT treat the missing value as 0.
5. WHEN a week W after a feature's initial baseline set has a non-null value `v` for that feature, THE Baseline_Module SHALL compute the z-score for that feature in W as `z = (v - m) / max(sd, 1e-6)`, where `m` is the mean and `sd` is the population standard deviation of that feature's baseline set as it stands after all weeks before W have been evaluated, excluding W's own value.
6. IF a week belongs to a feature's initial baseline set, THEN THE Baseline_Module SHALL NOT produce a z-score for that feature in that week.
7. IF a feature has fewer than `MIN_BASELINE_WEEKS` (12) weeks with non-null values, including zero such weeks, THEN THE Baseline_Module SHALL NOT produce a z-score for that feature in any week, and `computeBaseline(rows)` SHALL return no mean and no population standard deviation for that feature.
8. WHEN a week W has been evaluated through steps (a) and (b) of criterion 2, no change signal is open at W, and none of W's z-scored features has `|z| >= Z_THRESHOLD`, THE Baseline_Module SHALL append W's non-null value of each feature for which W is after that feature's initial baseline set to that feature's baseline set, so that the appended value is first used for the z-scores of the week following W.
9. IF any of a week's z-scored features has `|z| >= Z_THRESHOLD`, THEN THE Baseline_Module SHALL NOT append that week's value of any feature to a baseline set beyond that feature's initial baseline set, while still including that week's value in the initial baseline set of any feature for which the week belongs to the initial baseline set.
10. WHILE a change signal is open at the week being evaluated, THE Baseline_Module SHALL NOT append that week's value of any feature to a baseline set beyond that feature's initial baseline set, for that week and every later week in the series.
11. IF the population standard deviation `sd` of a baseline set is 0, THEN THE Baseline_Module SHALL divide by `1e-6` in place of `sd`, yielding a finite z-score that equals 0 when `v` equals the baseline mean `m`.
12. WHEN `computeBaseline(rows)` is called, THE Baseline_Module SHALL return, for each feature that has at least `MIN_BASELINE_WEEKS` (12) non-null weeks, the mean and population standard deviation of that feature's final baseline set after all rows are evaluated, where the final baseline set is the one produced by the same single chronological pass that `zScores(rows)` performs on the same rows.
13. THE Baseline_Module SHALL define `Z_THRESHOLD` equal to 2.0, `WEEKS_REQUIRED` equal to 3, `FEATURES_REQUIRED` equal to 2, and `MIN_BASELINE_WEEKS` equal to 12 together as named constants in `lib/baseline.ts`.
14. WHEN a week W is evaluated in step (b) of criterion 2, THE Baseline_Module SHALL determine whether a change signal is open at W by applying the detection condition of Requirement 4 (criteria 3 and 4, using `Z_THRESHOLD`, `WEEKS_REQUIRED`, and `FEATURES_REQUIRED`) to the z-scores computed in the same pass for the weeks up to and including W, and once a change signal is open at W SHALL treat it as open for every later week in the series.
15. WHEN `zScores(rows)` is called, THE Baseline_Module SHALL return exactly one entry per input row, identified by its `week_start` and ordered by ascending `week_start`, giving for each of the six features either the computed z-score or an explicit absence of a z-score where criterion 4, 6, or 7 prevents one, and SHALL return an empty result when `rows` is empty.

### Requirement 4: Change signal detection

**User Story:** As a user, I want one clear signal only when a change is real and sustained, so that I am not alarmed by a single unusual week.

#### Acceptance Criteria

1. THE Signal_Module SHALL re-export `Z_THRESHOLD`, `WEEKS_REQUIRED`, `FEATURES_REQUIRED`, and `MIN_BASELINE_WEEKS` from `lib/baseline.ts` in `lib/signal.ts`, without redefining their values, so that each re-exported constant is strictly equal to the constant of the same name in `lib/baseline.ts`.
2. THE Signal_Module SHALL expose `detectSignal(rows)` in `lib/signal.ts` as pure logic that performs no I/O, does not modify the provided rows, returns the same result for the same input on every call, takes every z-score from `zScores(rows)` of the Baseline_Module without recomputing it, and is exported for reuse by the `care-outputs` spec.
3. IF a feature has a z-score with `|z| >= Z_THRESHOLD`, regardless of sign, in each of at least `WEEKS_REQUIRED` (3) consecutive weeks ending at week W, THEN THE Signal_Module SHALL treat that feature as qualifying at week W, where two weeks are consecutive only when the later `week_start` is exactly 7 days after the earlier `week_start`, and where any missing week, null feature value, or week without a z-score for that feature (including weeks in that feature's initial baseline set) resets that feature's consecutive count to zero.
4. WHEN at least `FEATURES_REQUIRED` (2) features qualify at the same week W, THE Signal_Module SHALL return exactly one change signal from `detectSignal(rows)`, determined at the earliest week W at which this holds, and SHALL NOT return an additional change signal for any later week at which the condition holds again.
5. IF no week exists in the series at which at least `FEATURES_REQUIRED` (2) features qualify at that same week, including when `rows` is empty, THEN THE Signal_Module SHALL return null from `detectSignal(rows)`.
6. IF exactly one week in the series contains a z-score with `|z| >= Z_THRESHOLD` for any feature and every z-score of every feature in every other week has `|z| < Z_THRESHOLD`, THEN THE Signal_Module SHALL return null from `detectSignal(rows)`. _(Property P1)_
7. IF `rows` contain fewer than `MIN_BASELINE_WEEKS` (12) distinct `week_start` values, THEN THE Signal_Module SHALL return null from `detectSignal(rows)`. _(Property P6)_
8. WHEN `detectSignal(rows)` is given two inputs that contain the same rows, each row having a distinct `week_start`, in any two orders, THE Signal_Module SHALL return results that are either both null or both change signals with identical listed features in identical order and an identical first week. _(Property P5)_
9. WHEN the Signal_Module returns a change signal, THE Signal_Module SHALL list every feature that qualifies at the earliest week W from criterion 4, ordered as `vocabulary_diversity`, `mean_sentence_length`, `filler_rate`, `sleep_hours`, `active_minutes`, `twin_accuracy`, and SHALL give as the first week the earliest `week_start` at which any listed feature's unbroken run of consecutive deviating weeks ending at W begins.

### Requirement 5: Right-not-to-know gate

**User Story:** As a user, I want full control over whether a change is shown to me or only to my clinician, so that my right not to know is always honoured.

#### Acceptance Criteria

1. THE RTK_Gate SHALL expose `gate(signal, rtk_setting)` in `lib/signal.ts` returning an object `{showToUser, includeInSummary}` as pure logic without performing any I/O, exported for reuse by the `care-outputs` spec, where every consumer imports `gate` only from `lib/signal.ts` and no other module re-exports or reimplements `gate`.
2. WHEN `rtk_setting` is `tell_me`, THE RTK_Gate SHALL return `showToUser` equal to `true` and `includeInSummary` equal to `true`.
3. WHEN `rtk_setting` is `doctor_only`, THE RTK_Gate SHALL return `showToUser` equal to `false` and `includeInSummary` equal to `true`. _(Property P3)_
4. WHEN `rtk_setting` is `record_only`, THE RTK_Gate SHALL return `showToUser` equal to `false` and `includeInSummary` equal to `false`. _(Property P2)_
5. IF `rtk_setting` is any value other than `tell_me`, `doctor_only`, or `record_only` (including null, undefined, or an empty value), THEN THE RTK_Gate SHALL return `showToUser` equal to `false` and `includeInSummary` equal to `false`.
6. WHERE any UI path displays a change signal to the user, THE System SHALL call `gate()` and SHALL display the signal only when `gate().showToUser` is `true`.
7. WHERE any UI path evaluates a change signal and `gate().showToUser` is `false`, THE System SHALL NOT render the signal, its text, or any visual indicator of it to the user.
8. WHERE the System displays a change signal to the user, THE System SHALL use exactly the User_Facing_Signal_Text "I've noticed some changes over the past few weeks. You might want to talk to your doctor about it." with no additional, substituted, or omitted characters.
9. THE System SHALL NOT state or imply in any user-facing copy or model prompt that the user has, or is likely to have, any medical condition.

### Requirement 6: Reproducible synthetic history for Maya and weekly sleep aggregation

**User Story:** As a judge, I want Maya's 18-to-40 history to be reproducible and to show a change signal late in the timeline, so that the demo tells a consistent, believable story.

Until the `wearable-insights` spec lands, `sleep_hours` values come from the synthetic weekly file `data/synthetic/maya/weekly-features.json`. The Weekly_Module defines the daily-to-weekly aggregation that `wearable-insights` will feed.

#### Acceptance Criteria

1. WHEN `scripts/generate-maya.ts` runs, THE script SHALL write `data/synthetic/maya/weekly-features.json` using a seeded pseudo-random generator that depends only on a fixed seed and not on system time, locale, or environment.
2. WHEN `scripts/generate-maya.ts` runs more than once, THE script SHALL produce byte-for-byte identical output across runs and machines.
3. THE script SHALL read the date span from `data/synthetic/maya/profile.json` and write exactly one row per 7-day week spanning from the `start_date` (2026-10-24, age 18) to the `simulated_through` date (2048-10-24, age 40), inclusive of both endpoints.
4. WHILE Maya's simulated age is below 38.5, THE script SHALL keep each feature value within a small bounded deviation of Maya's baseline for that feature.
5. WHERE Maya's simulated age is at or above 38.5, THE script SHALL drift `vocabulary_diversity`, `sleep_hours`, and `twin_accuracy` monotonically downward relative to baseline and drift `filler_rate` monotonically upward relative to baseline, such that the deviation at `simulated_through` exceeds the deviation at age 38.5.
6. THE script SHALL produce feature values such that the Signal_Module first creates a change signal when Maya's simulated age is between 39 and 40.
7. IF Maya's simulated age is below 39, THEN THE script SHALL produce feature values that do not cause the Signal_Module to create a change signal.
8. WHEN the script writes a row, THE script SHALL set that row's `synthetic` value to `true`.
9. THE System SHALL include a calibration test that runs `detectSignal` over the generated `data/synthetic/maya/weekly-features.json` and verifies criteria 6 and 7.
10. THE Weekly_Module SHALL expose `weeklySleepHours(dailyRows)` in `lib/weekly.ts` as pure logic without performing any I/O.
11. WHEN `weeklySleepHours(dailyRows)` is called with the daily rows of one week, THE Weekly_Module SHALL return the arithmetic mean of the non-null `sleep_hours` values of those days.
12. IF a day in `dailyRows` has a null or missing `sleep_hours` value, THEN THE Weekly_Module SHALL exclude that day from both the sum and the count, and SHALL NOT treat the missing value as 0.
13. IF no day in `dailyRows` has a non-null `sleep_hours` value, THEN THE Weekly_Module SHALL return null.

### Requirement 7: Timeline route and Timeline screen

**User Story:** As a user, I want to see each feature over time against my baseline and control whether a signal is shown, so that I can explore my history and my right-not-to-know setting in one place.

The Timeline_Screen UI is built outside this spec's task list; criteria 7 to 14 remain the acceptance contract for that screen. Criteria 1, 2, 3, 4, and 15 apply only when the caller is opted in; a caller with no profile or with `health_layer_opt_in` equal to `false` is handled by Requirement 9.

#### Acceptance Criteria

1. WHEN an authenticated caller whose profile has `health_layer_opt_in` equal to `true` (Requirement 9) sends `GET /api/timeline`, THE Timeline_Route SHALL return every `weekly_features` row where `user_id` equals the caller's `auth.uid()`, ordered by ascending `week_start`, and SHALL return no row belonging to any other user.
2. WHEN an authenticated caller whose profile has `health_layer_opt_in` equal to `true` (Requirement 9) sends `GET /api/timeline`, THE Timeline_Route SHALL return, for each returned week and each feature, the z-score computed by `zScores(rows)`, with an explicit null (never 0) for any week and feature that has no z-score under Requirement 3 criteria 4, 6, and 7, and SHALL return, for each feature, the baseline mean and population standard deviation computed by `computeBaseline(rows)`, with an explicit null for any feature that has fewer than `MIN_BASELINE_WEEKS` (12) non-null weeks.
3. WHEN an authenticated caller whose profile has `health_layer_opt_in` equal to `true` (Requirement 9) sends `GET /api/timeline` and `detectSignal(rows)` returns a change signal, THE Timeline_Route SHALL pass the change signal through `gate(signal, rtk_setting)` using the `rtk_setting` read from the caller's own profile at request time, and SHALL include the change signal, with its listed deviating features and first week, in the response only when `gate().showToUser` is `true`.
4. IF the caller's profile exists with `health_layer_opt_in` equal to `true` and `gate().showToUser` is `false` for the caller's change signal, including when the profile's `rtk_setting` is `doctor_only`, `record_only`, null, or not one of `tell_me`, `doctor_only`, or `record_only`, THEN THE Timeline_Route SHALL omit the change signal from the response entirely, such that the response is indistinguishable from a response for the same rows in which `detectSignal(rows)` returned no change signal.
5. IF `GET /api/timeline` is sent without an authenticated caller, THEN THE Timeline_Route SHALL respond with HTTP status 401 and return no `weekly_features` rows, z-scores, baseline statistics, or change signal.
6. THE Timeline_Route SHALL validate its response against a zod schema defined in `lib/api-schemas.ts` before sending it, and IF the response fails that validation, THEN THE Timeline_Route SHALL respond with an error indicating the timeline is unavailable and SHALL return no `weekly_features` rows, z-scores, baseline statistics, or change signal.
7. WHILE the Timeline_Screen is displayed, THE Timeline_Screen SHALL render exactly one line chart for each of `vocabulary_diversity`, `mean_sentence_length`, `filler_rate`, `sleep_hours`, `active_minutes`, and `twin_accuracy` (six charts in total), plotting one point per returned week that has a non-null value for that feature and showing a week with a null value as a gap rather than as 0.
8. WHILE the Timeline_Screen is displayed, THE Timeline_Screen SHALL render on each feature chart a baseline band spanning from the feature's baseline mean minus two population standard deviations to the feature's baseline mean plus two population standard deviations, as returned by the Timeline_Route, and SHALL render no baseline band on a chart whose feature baseline is returned as null.
9. THE Timeline_Screen SHALL provide an age scrubber with a minimum value of 18 and a maximum value of 40, inclusive, in steps of 1 year, and WHEN the user sets the age scrubber to age A, THE Timeline_Screen SHALL highlight on every feature chart the week whose 7-day span contains the date equal to the profile `start_date` plus (A − 18) years.
10. WHILE `gate().showToUser` is `true` for the change signal returned by the Timeline_Route, THE Timeline_Screen SHALL render a signal marker on the chart of each deviating feature listed in the change signal, positioned at the change signal's first week, and SHALL accompany the marker with exactly the User_Facing_Signal_Text.
11. WHILE `gate().showToUser` is `false` for the change signal, or WHILE the Timeline_Route response contains no change signal, THE Timeline_Screen SHALL NOT render a signal marker, the User_Facing_Signal_Text, or any other visual indicator that a change signal exists.
12. THE Timeline_Screen SHALL provide a control that displays the user's current `rtk_setting` and offers exactly the three values `tell_me`, `doctor_only`, and `record_only`, and WHEN the user selects one of those values, THE Timeline_Screen SHALL change the user's `rtk_setting` to the selected value.
13. WHEN the user changes `rtk_setting` to `doctor_only` or `record_only`, THE Timeline_Screen SHALL remove every signal marker and the User_Facing_Signal_Text within 1 second of the change completing and without a page reload; WHEN the user changes `rtk_setting` to `tell_me`, THE Timeline_Screen SHALL re-request `GET /api/timeline` and render the signal marker only if the new response includes a change signal.
14. WHILE the Timeline_Screen is displayed, THE Timeline_Screen SHALL display a visible Synthetic_Label reading "Synthetic data" for the entire time the screen is shown, including while the age scrubber is moved and after `rtk_setting` is changed.
15. IF an authenticated caller whose profile has `health_layer_opt_in` equal to `true` (Requirement 9) sends `GET /api/timeline` and the caller has zero `weekly_features` rows, THEN THE Timeline_Route SHALL return a successful response containing an empty list of rows, no z-scores, a null baseline for every feature, and no change signal.
16. IF the Timeline_Route cannot read the caller's profile (including its `health_layer_opt_in` and `rtk_setting`) or the caller's `weekly_features` rows from the data store, THEN THE Timeline_Route SHALL respond with an error indicating the timeline is unavailable, SHALL NOT treat the failed profile read as a missing profile or as `opted_in: false`, and SHALL return no partial rows, z-scores, baseline statistics, `opted_in` value, or change signal.

### Requirement 8: County route and context card

**User Story:** As a user, I want to see how common short sleep is in my county, so that I have population context without being judged about my own sleep.

The Context_Card UI is built outside this spec's task list; criteria 6 to 11 remain the acceptance contract for that card.

#### Acceptance Criteria

1. WHEN an authenticated caller sends `GET /api/county`, THE County_Route SHALL read the `county` field of the caller's own profile and SHALL select the single row from `data/public/cdc-places-short-sleep-ma-2022.csv` whose `county` column value is a case-sensitive exact string match for that profile `county` value.
2. WHEN a matching county row is found, THE County_Route SHALL return exactly the card values `county` (string), `year` (integer), `prevalence` (number), `low` (number), and `high` (number) copied unchanged from that row, and SHALL NOT return the row's `population` value or any of the caller's own feature data.
3. IF the caller's profile does not exist, the profile `county` value is null or an empty string, or no row in `data/public/cdc-places-short-sleep-ma-2022.csv` has a `county` value exactly matching the profile `county` value, THEN THE County_Route SHALL return an explicit unavailable result that contains no `prevalence`, `low`, or `high` value.
4. IF `GET /api/county` is sent without an authenticated caller, THEN THE County_Route SHALL respond with HTTP status 401 and return no card values.
5. THE County_Route SHALL validate every response, both card values and the unavailable result, against a zod schema defined in `lib/api-schemas.ts`.
6. WHEN the County_Route returns card values to a caller whose profile `county` is `Hampshire` (Maya), THE Context_Card SHALL display county `Hampshire`, year `2022`, prevalence `31.5`, and the range `26.8` to `36.4`.
7. WHEN the County_Route returns card values, THE Context_Card SHALL display the `prevalence` value followed by a percent sign, without rounding the source value, described as the share of adults in that county who sleep under 7 hours in the returned `year`, together with the `low` to `high` range and the county name.
8. WHEN the Context_Card displays card values, THE Context_Card SHALL label the figure as a county-level population estimate from CDC PLACES, and SHALL NOT use any evaluative wording about the user's sleep (including "good", "bad", "healthy", "unhealthy", "poor", "normal", or "at risk").
9. THE Context_Card SHALL NOT state or imply that the user has, or is likely to have, any medical condition.
10. THE Context_Card SHALL NOT display the user's own `sleep_hours` value and SHALL NOT compare, relate, or reference the user's own sleep against the displayed county prevalence figure.
11. WHEN the County_Route returns the unavailable result, THE Context_Card SHALL NOT display a prevalence, low, or high value and SHALL show an indication that county context is unavailable.
12. IF `data/public/cdc-places-short-sleep-ma-2022.csv` cannot be read, or the matching row has a `prevalence`, `low`, or `high` value that is non-numeric, outside the inclusive range 0 to 100, or violates `low <= prevalence <= high`, THEN THE County_Route SHALL return the unavailable result and SHALL NOT return any value from that row.
13. IF a County_Route response fails validation against its zod schema, THEN THE County_Route SHALL NOT return the unvalidated card values and SHALL return an error response.

### Requirement 9: Health layer opt-in

**User Story:** As a user, I want my health history shown only after I have turned the health layer on, so that nothing about my health is shown before I opt in.

The Timeline_Screen UI parts of this requirement are built outside this spec's task list; criteria 5 and 6 remain the acceptance contract for that screen. The County_Route is population context and is not affected by `health_layer_opt_in`.

#### Acceptance Criteria

1. IF an authenticated caller sends `GET /api/timeline`, the caller's profile read succeeds (Requirement 7 criterion 16 covers a failed read), and the caller has no profile or the caller's profile has a `health_layer_opt_in` value other than exactly `true` (including `false`, null, or a missing value), THEN THE Timeline_Route SHALL respond with HTTP status 200 and exactly the body `{ "opted_in": false }`, containing no `weekly_features` rows, z-scores, baseline statistics, `rtk_setting`, or change signal.
2. IF the caller has no profile or the caller's profile has a `health_layer_opt_in` value other than exactly `true`, THEN THE Timeline_Route SHALL NOT read the caller's `weekly_features` rows and SHALL NOT call `detectSignal`, where the Timeline_Route applies the authentication check of Requirement 7 criterion 5 before reading the caller's profile and evaluates `health_layer_opt_in` before any read of `weekly_features` rows, so that the response does not depend on whether rows or a change signal exist.
3. WHEN an authenticated caller whose profile has `health_layer_opt_in` equal to exactly `true` sends `GET /api/timeline`, THE Timeline_Route SHALL respond with `opted_in` equal to `true` together with the fields defined in Requirement 7 criteria 1, 2, 3, 4, and 15.
4. THE Timeline_Route SHALL validate the `{ "opted_in": false }` body, before sending it, against the same zod schema in `lib/api-schemas.ts` as the opted-in response, where that schema is a discriminated union on `opted_in`.
5. WHEN the Timeline_Route returns `opted_in` equal to `false`, THE Timeline_Screen SHALL show no feature charts, baseline bands, signal marker, or User_Facing_Signal_Text, and SHALL offer a control to turn the health layer on.
6. WHEN the user turns the health layer on from the Timeline_Screen, THE System SHALL set the caller's own `profiles.health_layer_opt_in` to `true` under row-level security on the caller's own row only, and THE Timeline_Screen SHALL re-request `GET /api/timeline` after that update completes successfully.
7. THE System SHALL include unit tests for the Timeline_Route covering the no-profile case and the `health_layer_opt_in` equal to `false` case, each asserting the exact `{ "opted_in": false }` body and asserting that no `weekly_features` rows were read through the Weekly_Feature_Repository.

## Correctness Properties

These properties are carried into design and verified with fast-check. Each is attached to
the requirement(s) it governs.

- **P1 — A single spike never signals.** For any history where exactly one week reaches `|z| >= Z_THRESHOLD` while every other week stays below `Z_THRESHOLD`, the Signal_Module produces no change signal. _(Requirement 4)_
- **P2 — `record_only` hides everywhere.** For any signal, `gate(signal, "record_only")` returns `showToUser` equal to `false` and `includeInSummary` equal to `false`. _(Requirement 5)_
- **P3 — `doctor_only` hides from the user.** For any signal, `gate(signal, "doctor_only").showToUser` is `false`. _(Requirement 5)_
- **P4 — Speech features are deterministic and bounded.** For any transcript, the output of `extractSpeechFeatures` is identical across repeated computations, `vocabulary_diversity` is within [0, 1], and `filler_rate` is greater than or equal to 0. _(Requirement 1)_
- **P5 — Detection is order-independent.** For any set of input rows, each with a distinct `week_start`, `detectSignal` returns results that are either both null or both change signals with identical listed features in identical order and an identical first week, regardless of the ordering of those rows. _(Requirement 4)_
- **P6 — Not enough history, no signal.** For any history with fewer than `MIN_BASELINE_WEEKS` weeks of data, the Signal_Module produces no change signal. _(Requirement 4)_

## Out of Scope

The following are explicitly out of scope for the `health-baseline` spec and are handled by other specs:

- The core predict-and-correct loop, the vault, voice check-in, and the session score (covered by `twin-loop`). This spec consumes the twin-accuracy trend as a feature but does not produce it, and extends the existing vault delete only to cover `weekly_features`.
- Email drafting and the assistant inbox (covered by `assistant-tasks`).
- The clinician summary, the trial finder, and family mode (covered by `care-outputs`). This spec defines how a signal is gated into the summary via `includeInSummary` and exports `lib/baseline.ts` and `lib/signal.ts` for reuse, but does not render the summary.
- Daily wearable ingestion (covered by `wearable-insights`). Until that spec lands, `sleep_hours` comes from the synthetic weekly file.
- Building the Timeline_Screen and Context_Card UI, including the Timeline_Screen opt-in control of Requirement 9; these are built outside this spec's task list, and their criteria remain the acceptance contract.
- The `profiles.health_layer_opt_in` column, its default, and the onboarding choice that sets it (covered by `twin-loop`). This spec only reads the column in the Timeline_Route and sets it from the Timeline_Screen opt-in control.
