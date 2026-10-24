# Requirements Document

## Introduction

The `care-outputs` feature turns a person's baseline and vault into three outward-facing
surfaces: a printable clinician summary at `/summary`, a recruiting-trial finder at
`/trials`, and a family-mode question answer at `/family`. It is the fourth and final
spec in the build order (`twin-loop` → `assistant-tasks` → `health-baseline` →
`care-outputs`), so it consumes work the earlier specs produced rather than redefining it.

The clinician summary is one printable page that follows the CMS ACCESS Model Care Update
Template layout, adapted for iamyou as described in `docs/clinician-summary-fields.md`. It
states plainly that it is not a diagnosis, shows the person's own measures against their
own baseline, and reveals a "What changed" section only when the right-not-to-know gate
allows it. The trial finder lists recruiting studies with a Massachusetts site for the
family condition, drawn live from the ClinicalTrials.gov API v2 with the saved slice in
`data/public/` as an offline fallback. Family mode lets a named relative ask a question
and receives an answer grounded only in vault entries, with the entries it used listed.

Pure logic lives in `lib/` with no I/O: `buildSummary` in `lib/summary.ts`,
`filterTrials` and the normalization, phase-label, and keyword-matching helpers in
`lib/trials.ts`, and `validateFamilyAnswer` in `lib/family.ts`. Server routes perform all
I/O: the trial finder route does the HTTP fetch, caching, and CSV fallback, and the family
route is the only place Claude is called. Claude lives in server-only code under
`lib/claude/`.

All work in this spec obeys the non-negotiable rules in `AGENTS.md` and `.kiro/steering/`:
synthetic data only, never diagnose, the right-not-to-know gate, synthetic screens are
labelled, pure logic in `lib/` has no I/O, secrets stay server-side, and Claude is called
only from server routes.

## Glossary

- **System**: The iamyou `care-outputs` feature, comprising the Next.js client, its server routes, and the pure modules `lib/summary.ts`, `lib/trials.ts`, and `lib/family.ts`.
- **Summary_Builder**: The pure function `buildSummary` in `lib/summary.ts` that assembles the clinician summary fields from profile, weekly-feature, baseline, and gate inputs without performing any I/O.
- **Summary_Screen**: The client screen at `/summary` that renders one printable page from the Summary_Builder output.
- **Trials_Module**: The pure module `lib/trials.ts` holding `filterTrials`, source normalization, phase labels, and keyword matching, with no I/O.
- **Trials_Route**: The server route backing `/trials` that performs the HTTP fetch to the Trials_API, caches responses, and falls back to the Saved_MA_Slice.
- **Trials_Cache**: The server-side cache in the Trials_Route that holds a successful Trials_API response for 3600 seconds (1 hour) per family_condition.
- **Trials_Screen**: The client screen at `/trials` that lists normalized Trial records.
- **Trials_API**: The ClinicalTrials.gov API v2 endpoint `GET https://clinicaltrials.gov/api/v2/studies`.
- **Saved_MA_Slice**: The offline fallback file `data/public/clinicaltrials-ma-recruiting-2026-10-18.csv`, whose rows are all RECRUITING studies from a Massachusetts-location query, with columns `nct_id`, `title`, `phase`, `conditions`, `massachusetts_city`, and `status`.
- **Trial**: The normalized record shape `{nctId: string, title: string, phaseLabel: string, conditions: string[], status: string, cities: string[], source: "live" | "saved_ma_slice"}`.
- **family_condition**: The condition from `profile.family_history`; one of `huntington`, `familial_alzheimers`, or `als`. Maya's value is `familial_alzheimers`.
- **Phase_Label**: The deterministic plain-language label the Trials_Module assigns to a raw phase value.
- **Family_Module**: The pure function `validateFamilyAnswer` in `lib/family.ts` that filters cited entry ids and selects the answer text, with no I/O.
- **Family_Route**: The server route backing `/family` that sends vault entries to Claude and receives an answer, and is the only place Claude is called.
- **Family_Screen**: The client screen at `/family` that shows who is asking, the answer, and the cited entries.
- **Family_Answer**: The Claude response shape `{answer: string, cited_entry_ids: string[]}`.
- **Dont_Know_Answer**: The exact string "I don't know how {first_name} would answer that.", where `{first_name}` is `profile.first_name`.
- **vault entry**: A record in the person's vault with an `id`, a `kind` (one of `story`, `opinion`, `conversation`, `correction`, or `style_example`), and a `text`, produced by `twin-loop`.
- **RTK_Gate**: The pure function `gate(signal, rtk_setting)` in `lib/signal.ts` from the `health-baseline` spec, returning `{showToUser, includeInSummary}`. Consumed here, not redefined.
- **Baseline_Module**: The pure module `lib/baseline.ts` from the `health-baseline` spec, providing each feature's baseline mean, most recent 4-week mean, and z-score. Consumed here, not redefined.
- **Signal_Module**: The pure module `lib/signal.ts` from the `health-baseline` spec, producing the change signal. Consumed here, not redefined.
- **change signal**: The record produced by the Signal_Module listing the deviating features and the first week of the run. Consumed here, not redefined.
- **feature**: One of `vocabulary_diversity`, `mean_sentence_length`, `filler_rate`, `sleep_hours`, `active_minutes`, or `twin_accuracy`, as defined by the `health-baseline` spec.
- **weekly_features**: The per-user weekly feature rows produced by the `health-baseline` spec; the ordered source for baseline and most-recent means. Consumed here, not redefined.
- **rtk_setting**: The right-not-to-know setting from the profile; one of `tell_me`, `doctor_only`, or `record_only`. Consumed here, not redefined.
- **Claude_Helpers**: The server-only Claude code under `lib/claude/` using the SDK, model, and configuration defined in `.kiro/steering/tech.md`. Consumed here, not redefined.
- **Synthetic_Label**: A visible "Synthetic data" label shown on any screen that displays synthetic persona or history data.
- **Not_A_Diagnosis_Footer**: The exact footer string "This is not a diagnosis.".
- **No_Change_Text**: The exact string "No change to report.".
- **No_Match_Text**: The exact string "No matching studies recruiting in Massachusetts right now.".
- **Condition_Search_URL**: The ClinicalTrials.gov website search for the family_condition, limited to recruiting studies in Massachusetts, at `https://clinicaltrials.gov/search`.
- **FAMILY_ENTRY_LIMIT**: The constant `40`; the maximum number of vault entries sent to Claude for a family-mode answer.

## Requirements

### Requirement 1: Clinician summary page structure

**User Story:** As a person with a family history, I want one printable page that a clinician can read at a glance, so that I can share my own baseline in a familiar, non-diagnostic form.

#### Acceptance Criteria

1. THE Summary_Screen SHALL render the clinician summary at `/summary` as a single page that, when printed, fits on one printed page without horizontal clipping and is not split across pages.
2. THE Summary_Screen SHALL render exactly the 14 fields defined in `docs/clinician-summary-fields.md`, in the order given there, and SHALL NOT add fields beyond those 14.
3. THE Summary_Builder SHALL assemble field 1 (Subject) as "iamyou Care Summary, [Update / Change noticed], [name]", using "Change noticed" when `gate(signal, rtk_setting).includeInSummary` is `true` and "Update" otherwise, and where [name] is the person's first initial, a period, a space, and the last name from the profile (for example "M. Linden").
4. IF the profile has no last name, THEN THE Summary_Builder SHALL still produce field 1 using the available name parts and SHALL NOT fail to assemble the summary.
5. THE Summary_Builder SHALL set field 2 (Intro) to exactly the fixed text "This summary was prepared by iamyou at the person's request, from their own conversations and wearable data. It is not a diagnosis and no clinician has reviewed it.".
6. THE Summary_Builder SHALL set field 14 (Footer) to exactly the Not_A_Diagnosis_Footer "This is not a diagnosis." and THE Summary_Screen SHALL always render the Footer.
7. THE Summary_Builder SHALL assemble all summary fields as a pure function of its inputs in `lib/summary.ts`, producing identical output for identical inputs, without performing any I/O or calling any model.

### Requirement 2: Measures field against the person's own baseline

**User Story:** As a person, I want each of my measures shown against my own baseline, so that a clinician sees change relative to me and never a target I was supposed to hit.

#### Acceptance Criteria

1. THE Summary_Builder SHALL render field 8 (Measures) with exactly one row per feature, in the order `vocabulary_diversity`, `mean_sentence_length`, `filler_rate`, `sleep_hours`, `active_minutes`, `twin_accuracy`, and SHALL render no additional rows.
2. FOR each feature row, THE Summary_Builder SHALL show the baseline mean, the most recent 4-week mean, and the change against the person's own baseline expressed as a z-score, each taken from the Baseline_Module for that feature.
3. IF the Baseline_Module reports that the z-score for a feature is unavailable because fewer than `MIN_BASELINE_WEEKS` weeks of prior data exist, THEN THE Summary_Builder SHALL render that feature's row with the baseline mean and most recent 4-week mean it has and SHALL show a not-available indicator in place of the z-score rather than any numeric value or target.
4. THE Summary_Builder SHALL NOT include any target value in any feature row of field 8.
5. THE Summary_Builder SHALL derive the baseline mean, the most recent 4-week mean, and the z-score for each feature from `weekly_features` via the Baseline_Module and SHALL NOT recompute these values with its own logic.

### Requirement 3: Gated "What changed" field

**User Story:** As a person, I want the "What changed" section to appear only when my right-not-to-know setting allows it, so that my choice controls what a clinician sees.

#### Acceptance Criteria

1. WHEN `gate(signal, rtk_setting).includeInSummary` is `true`, THE Summary_Builder SHALL populate field 10 (What changed) with a plain description naming which measures moved, the timeframe since when they moved relative to the baseline start, and the change amount against the person's own baseline.
2. IF `gate(signal, rtk_setting).includeInSummary` is `false`, THEN THE Summary_Builder SHALL set field 10 (What changed) to exactly the No_Change_Text "No change to report." and SHALL NOT include any measure-change details in field 10. _(Property P3)_
3. WHERE field 10 (What changed) is populated with change details, THE Summary_Builder SHALL include only the measure names, the timeframe, and the change amount, and SHALL NOT include any clinical interpretation, assessment, or statement that the person has or is likely to have a condition.
4. THE Summary_Builder SHALL obtain `includeInSummary` by calling `gate()` from `lib/signal.ts` with the change signal from the Signal_Module and the `rtk_setting` from the profile, and SHALL NOT reimplement the gate logic.
5. IF no change signal is available or the gate result cannot be read, THEN THE Summary_Builder SHALL set field 10 (What changed) to exactly the No_Change_Text "No change to report." and SHALL NOT include any measure-change details. _(Property P3)_

### Requirement 4: Synthetic labelling and non-diagnostic copy on the summary

**User Story:** As a judge viewing Maya's summary, I want any synthetic data clearly labelled and no diagnostic language anywhere, so that the page is honest about its source and its limits.

#### Acceptance Criteria

1. WHERE the Summary_Screen displays synthetic persona or history data, THE Summary_Screen SHALL display a Synthetic_Label reading exactly "Synthetic data" on the same page and adjacent to the synthetic data it labels.
2. WHERE the person is Maya, THE Summary_Screen SHALL treat the page data as synthetic and SHALL display the Synthetic_Label.
3. IF the System cannot confirm whether the displayed data is synthetic, THEN THE Summary_Screen SHALL display the Synthetic_Label.
4. THE Summary_Builder SHALL reflect in field 9 (Data sources) whether any displayed data is synthetic.
5. THE Summary_Builder SHALL NOT state or imply in any summary field that the person has, or is likely to have, any medical condition.
6. THE System SHALL NOT state or imply in any model prompt used to assemble the summary that the person has, or is likely to have, any medical condition.

### Requirement 5: Trial finder live source

**User Story:** As a person with a family history, I want to see recruiting studies with a Massachusetts site for my family's condition, so that I can explore options without searching a clinical registry myself.

#### Acceptance Criteria

1. WHEN the Trials_Route serves `/trials`, THE Trials_Route SHALL request `GET https://clinicaltrials.gov/api/v2/studies` with `query.cond` set to the family_condition, `query.locn` set to "Massachusetts", `filter.overallStatus` set to "RECRUITING", and `fields` set to request NCTId, BriefTitle, OverallStatus, Condition, Phase, and the location city and state.
2. THE Trials_Route SHALL derive the family_condition from `profile.family_history`, which is one of `huntington`, `familial_alzheimers`, or `als`, and WHERE the person is Maya THE Trials_Route SHALL use `familial_alzheimers`.
3. IF `profile.family_history` is absent or is not one of `huntington`, `familial_alzheimers`, or `als`, THEN THE Trials_Route SHALL NOT request the Trials_API and SHALL serve a result indicating no family condition is available.
4. WHEN the Trials_Route receives a successful response from the Trials_API, THE Trials_Route SHALL store that response in the Trials_Cache for 3600 seconds (1 hour) keyed by family_condition.
5. WHILE a cached response for the requested family_condition is present and younger than 3600 seconds, THE Trials_Route SHALL serve the cached response and SHALL NOT request the Trials_API again for that family_condition.
6. IF the Trials_API request returns an error or does not complete within 10 seconds, THEN THE Trials_Route SHALL serve the most recent cached response for that family_condition if one is present, and otherwise SHALL fall back to the Saved_MA_Slice.
7. WHEN the Trials_API returns zero matching studies, THE Trials_Route SHALL serve an empty trial list and SHALL indicate that no recruiting Massachusetts studies were found.
8. THE Trials_Route SHALL perform the HTTP fetch, the caching, and the fallback in server code, and SHALL NOT perform HTTP fetches from the client.

### Requirement 6: Trial finder offline fallback

**User Story:** As a judge opening the demo on a phone, I want the trial list to work even when the live registry is unreachable, so that the demo never shows a broken screen.

#### Acceptance Criteria

1. IF the Trials_API request fails, returns an error, or does not complete within 10 seconds, and no usable cached response is present, THEN THE Trials_Route SHALL read the Saved_MA_Slice `data/public/clinicaltrials-ma-recruiting-2026-10-18.csv` and serve trials from it.
2. WHEN serving from the Saved_MA_Slice, THE Trials_Module SHALL match the family_condition against the row's `conditions` or `title` by case-insensitive keyword, matching `huntington` against the keyword "huntington", `familial_alzheimers` against the keyword "alzheimer", and `als` against the keywords "amyotrophic lateral sclerosis", "motor neuron", or the whole word "ALS".
3. WHEN serving from the Saved_MA_Slice, THE Trials_Module SHALL treat every row as status RECRUITING, consistent with the file's contents.
4. WHEN a Saved_MA_Slice row is normalized, THE Trials_Module SHALL set its `cities` to the single entry `["Massachusetts"]` without a city name, because the slice's `massachusetts_city` column is empty.
5. IF no Saved_MA_Slice row matches the family_condition keywords, or the family_condition has no defined keyword mapping, THEN THE Trials_Module SHALL return an empty trial list and SHALL NOT substitute non-matching rows, and THE Trials_Screen SHALL display exactly the No_Match_Text "No matching studies recruiting in Massachusetts right now." together with a link to the Condition_Search_URL for the family_condition.

### Requirement 7: Trial normalization and phase labels

**User Story:** As a person, I want trials shown in plain language with a consistent shape, so that I can read them whether they came from the live registry or the saved slice.

#### Acceptance Criteria

1. THE Trials_Module SHALL normalize both the live source and the Saved_MA_Slice into the Trial shape `{nctId, title, phaseLabel, conditions: string[], status, cities: string[], source}`, where `source` is `"live"` for live results and `"saved_ma_slice"` for fallback results.
2. IF a source field required by the Trial shape is absent, null, or non-string where a string is expected, THEN THE Trials_Module SHALL normalize `conditions` and `cities` to an empty array and SHALL normalize `nctId`, `title`, and `status` to an empty string, so that every normalized Trial has all fields present.
3. THE Trials_Module SHALL assign a deterministic Phase_Label for every phase value, covering `EARLY_PHASE1`, `PHASE1`, `PHASE2`, `PHASE3`, `PHASE4`, combined values such as "PHASE1, PHASE2", `NA`, and an empty or blank value.
4. THE Trials_Module SHALL label `PHASE1` as "Phase 1: first tests in people" and SHALL label `NA` as "Not a drug trial".
5. WHEN the phase value is a combined value listing two or more recognized phases, THE Trials_Module SHALL produce a Phase_Label composed of the individual recognized Phase_Labels joined in the order they appear in the phase value, so that the combined label is deterministic.
6. IF the phase value is empty, blank, or not a recognized phase value, THEN THE Trials_Module SHALL assign a single deterministic fallback Phase_Label indicating the phase is unknown.
7. THE Trials_Module SHALL compute normalization, phase labels, keyword matching, and filtering as pure logic in `lib/trials.ts` without performing any I/O.
8. WHEN rendering a trial, THE Trials_Screen SHALL render that trial's `phaseLabel` as plain-language text and SHALL NOT render the raw phase value.

### Requirement 8: Trial finder display and filtering

**User Story:** As a person, I want only recruiting Massachusetts studies listed, each linking to its record, with a clear note that listing is not a recommendation, so that I can explore safely.

#### Acceptance Criteria

1. THE Trials_Module SHALL expose `filterTrials` as a pure function that, for identical input, returns identical output, does not mutate its input, and returns only trials whose status is RECRUITING.
2. WHERE a trial has `source` equal to `"live"` and has at least one Massachusetts location, THE `filterTrials` function SHALL return that trial. _(Property P1)_
3. IF a trial has `source` equal to `"live"` and has no Massachusetts location, THEN THE `filterTrials` function SHALL NOT return that trial. _(Property P1)_
4. WHERE a trial has `source` equal to `"saved_ma_slice"`, THE `filterTrials` function SHALL return that trial with `cities` equal to `["Massachusetts"]` and SHALL NOT include a city name. _(Property P1)_
5. WHEN the Trials_Screen renders a trial, THE Trials_Screen SHALL render a link to `https://clinicaltrials.gov/study/{nctId}`, substituting the trial's `nctId`.
6. IF a trial's `nctId` is empty or absent, THEN THE Trials_Screen SHALL NOT render a study link for that trial.
7. THE Trials_Screen SHALL state that listing a study is not a recommendation to join it.
8. WHEN the Trials_Screen renders a trial, THE Trials_Screen SHALL display that trial's conditions, its Phase_Label, and its cities.
9. WHEN the filtered trial list is empty, THE Trials_Screen SHALL indicate that no recruiting Massachusetts studies were found.

### Requirement 9: Family mode question and grounded answer

**User Story:** As a named relative, I want to ask how the person would answer a question and get a reply grounded only in their own words, so that the answer reflects the person and not a guess.

#### Acceptance Criteria

1. WHEN the Family_Screen loads, THE Family_Screen SHALL display who is asking, taken from `profile.digital_will.family_mode_access`, and WHERE the person is Maya THE Family_Screen SHALL display the asker as "Ella Linden (daughter)".
2. WHEN a relative submits a question, THE Family_Route SHALL select at most FAMILY_ENTRY_LIMIT (40) vault entries whose `kind` is one of `story`, `opinion`, `conversation`, or `correction`, and SHALL NOT select any entry whose `kind` is `style_example`.
3. WHEN the Family_Route calls Claude, THE Family_Route SHALL send the selected vault entries together with their ids.
4. IF no vault entry of an allowed kind is available, THEN THE Family_Route SHALL NOT call Claude and SHALL return the Dont_Know_Answer with an empty `cited_entry_ids`.
5. WHEN the Family_Route receives a Claude response, THE Family_Route SHALL treat it as a Family_Answer of shape `{answer: string, cited_entry_ids: string[]}` whose `cited_entry_ids` are constrained to the ids of entries that were sent.
6. IF the Claude response has `stop_reason` equal to `"refusal"`, THEN THE Family_Route SHALL NOT read the response content and SHALL return a safe fallback answer.
7. THE Family_Route SHALL call Claude only in server code under `lib/claude/`, SHALL NOT call Claude from the client, and SHALL use the model `claude-opus-5-5` with `output_config.effort` set to `medium` as defined in `.kiro/steering/tech.md`.

### Requirement 10: Family answer validation

**User Story:** As the person whose twin is answering, I want every family-mode answer to be backed by a real vault entry or to admit it does not know, so that no answer is invented.

#### Acceptance Criteria

1. THE Family_Module SHALL expose `validateFamilyAnswer` as a pure function in `lib/family.ts` that accepts a Family_Answer and the provided vault entries and returns a Family_Answer whose `cited_entry_ids` contains only those input `cited_entry_ids` each equal to the `id` of some provided vault entry.
2. IF no cited id remains after filtering, THEN THE Family_Module SHALL return a Family_Answer whose `answer` is exactly the Dont_Know_Answer "I don't know how {first_name} would answer that." substituting `profile.first_name`, and whose `cited_entry_ids` is empty. _(Property P2)_
3. WHEN at least one cited id remains after filtering, THE Family_Module SHALL return a Family_Answer whose `answer` is the input `answer` unchanged and whose `cited_entry_ids` is the remaining existing cited ids. _(Property P2)_
4. THE Family_Module SHALL preserve the input order of the surviving `cited_entry_ids`, SHALL remove duplicate ids, and SHALL NOT add any id that was not in the input `cited_entry_ids`. _(Property P2)_
5. WHEN the returned Family_Answer has one or more `cited_entry_ids`, THE Family_Screen SHALL list the `text` of each provided vault entry whose `id` is in the returned `cited_entry_ids`, and SHALL NOT list any other vault entry.
6. IF the returned Family_Answer has an empty `cited_entry_ids`, THEN THE Family_Screen SHALL list no cited vault entries.
7. THE System SHALL NOT produce, in any family-mode answer text or any family-mode model prompt, a statement that speculates about the person's health, diagnosis, or genetic status.
8. THE Family_Module SHALL perform all validation as pure logic in `lib/family.ts` without performing any I/O or calling any model.

## Correctness Properties

These properties are carried into design and verified with fast-check. Each is attached to
the requirement(s) it governs.

- **P1 — Filtered trials are recruiting and Massachusetts-anchored.** For any set of trials, `filterTrials` returns only trials with status RECRUITING; every returned trial with `source` equal to `"live"` has at least one Massachusetts location; and every returned trial with `source` equal to `"saved_ma_slice"` has `cities` equal to `["Massachusetts"]` with no city name. _(Requirement 8)_
- **P2 — A family answer is cited or admits it does not know.** For any Family_Answer and any set of provided vault entries, `validateFamilyAnswer` either returns an answer citing at least one existing vault id or returns exactly the Dont_Know_Answer "I don't know how {first_name} would answer that.". _(Requirement 10)_
- **P3 — A closed gate hides change details.** For any inputs where `gate(signal, rtk_setting).includeInSummary` is `false`, `buildSummary` sets field 10 to exactly "No change to report." and includes no measure-change details. _(Requirement 3)_

## Out of Scope

The following are explicitly out of scope for the `care-outputs` spec:

- Any diagnostic claim or clinical interpretation of the person's measures, change signal, or trials.
- Real trial enrollment, contacting study sites, or any action beyond linking to a study record.
- Real email delivery or any outbound message; the summary and family answer are read-only outputs.
- Recommending specific trials or ranking trials by suitability; listing is not a recommendation.
- Interpreting genetic test results or making any statement about the person's genetic status; genetics questions go to a genetic counselor (rule 6).
- The speech features, personal baseline, change signal, the right-not-to-know gate, and `weekly_features` (produced by `health-baseline` and consumed here).
- The vault, the predict-and-correct loop, voice check-in, and style examples (produced by `twin-loop` and consumed here).
- Email drafting and the assistant inbox (covered by `assistant-tasks`).
