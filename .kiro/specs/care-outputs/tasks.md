# Implementation Plan: care-outputs

## Overview

This plan implements the logic, routes and tests behind the three care outputs: the
clinician summary (`buildSummary`, `POST /api/summary`), the trial finder (`lib/trials.ts`,
`GET /api/trials` with live API, cache and saved-slice fallback) and family mode
(`lib/family.ts`, `familyAnswer`, `GET`/`POST /api/family`). Work goes bottom-up: align
with `health-baseline` first, then the pure modules with their property tests, the
migration, the schemas, the Claude layer and the routes.

Every task is tagged `[kiro]`. Claude Code builds the summary page, the trial list and the
family mode screen, so this plan has no UI page tasks. Every property test (P1–P5) is
required.

`lib/trials.ts`, `lib/family.ts` and the trials and family routes do not depend on
`health-baseline`. Task 5 (`lib/summary.ts`) and task 11 (summary route) need
`lib/baseline.ts`, `lib/signal.ts` and the weekly feature repository from `health-baseline`
to exist.

## Tasks

- [ ] 1. [kiro] Align with the health-baseline contract
  - Compare the "health-baseline contract" section of `care-outputs/design.md` with
    `health-baseline/design.md` and, once implemented, `lib/baseline.ts`, `lib/signal.ts`
    and `lib/db/weekly-feature-repository.ts`: names and signatures of `gate`,
    `detectSignal`, `computeBaseline`, `zScores`, the `Feature` and `WeeklyFeatureRow`
    types, `MIN_BASELINE_WEEKS`, `WeeklyFeatureRepository` and its in-memory class, and
    the migration number before `0004`
  - Import `gate(signal, rtk_setting)` and `detectSignal` from `lib/signal.ts`, as
    `health-baseline` Requirement 5.1 specifies
  - Confirm `computeBaseline` accepts a window length for the recent 4-week mean; if it
    does not, raise the change in the `health-baseline` spec rather than computing means
    in `care-outputs`
  - Update `care-outputs/design.md` wherever a name differs; never copy the logic
  - _Requirements: 2.5, 3.4_

- [x] 2. [kiro] Implement the trials module `lib/trials.ts`
  - [x] 2.1 Implement the pure trial functions and constants
    - Define `FamilyCondition`, `FAMILY_CONDITIONS`, `isFamilyCondition`, `TrialSource`,
      `Trial`, `CONDITION_QUERY`, `NO_MATCH_TEXT` ("No matching studies recruiting in
      Massachusetts right now."), `NOT_A_RECOMMENDATION_TEXT` and `MASSACHUSETTS`
    - Implement `phaseLabel(raw)` for a string or string array: split on commas, trim,
      upper-case, map with the design's table (`PHASE1` → "Phase 1: first tests in
      people", `NA` → "Not a drug trial"), dedupe recognized tokens and join with " / " in
      input order, and return "Phase not listed" when nothing is recognized
    - Implement `normalizeTrial(raw, source)`: for `live`, read the API v2
      `protocolSection` fields and keep only cities of locations whose state is
      Massachusetts (trimmed, case-insensitive; a blank city becomes "Massachusetts";
      deduped, in order); for `saved_ma_slice`, read the CSV columns, split `conditions`
      on commas, and force `status` "RECRUITING" and `cities` `["Massachusetts"]`; any
      missing or non-string field becomes `""` or `[]`
    - Implement `matchesCondition(trial, condition)` over conditions and title,
      case-insensitive: "huntington"; "alzheimer"; "amyotrophic lateral sclerosis",
      "motor neuron" or `/\bals\b/i`; `false` for any other condition
    - Implement `filterTrials(trials)`: drop non-RECRUITING, keep `live` only with a
      non-empty `cities`, keep `saved_ma_slice` with `cities` replaced by
      `["Massachusetts"]`, drop any other source; return new objects in input order
      without mutating input
    - Implement `parseSliceCsv(text)` (RFC 4180: quoted fields, doubled quotes, commas and
      newlines in quotes), `studyUrl(nctId)` (null for blank) and
      `conditionSearchUrl(condition)` exactly as in the design
    - No I/O and no server-only imports
    - _Requirements: 5.1, 6.2, 6.3, 6.4, 6.5, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_
  - [x] 2.2 Write property test P1 for `normalizeTrial` + `filterTrials` (tests/pbt)
    - **Property P1: Filtered trials are recruiting and Massachusetts-anchored**: for
      arbitrary raw live studies (mixed statuses, states including "Massachusetts" in
      varied case, other states, blank and null) and raw slice rows, every returned trial
      is RECRUITING; every returned live trial had a Massachusetts location and every
      recruiting live study with one is returned; every returned slice trial has `cities`
      equal to `["Massachusetts"]`; deep-frozen input is not mutated; repeated calls are
      equal. Also assert the invariants for `filterTrials` over arbitrary `Trial` values
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 6.3, 6.4**
  - [x] 2.3 Write property test P5 for `phaseLabel` (tests/pbt)
    - **Property P5: Phase labels are total and deterministic**: for arbitrary strings,
      string arrays and other values, `phaseLabel` returns a non-empty string, equal
      across calls; single recognized tokens map to the table; combined values equal the
      recognized labels joined with " / " in input order
    - **Validates: Requirements 7.3, 7.4, 7.5, 7.6**
  - [x] 2.4 Write unit tests for `lib/trials.ts`
    - Exact labels for every phase value in the slice (`NA`, blank, `EARLY_PHASE1`,
      `PHASE1`–`PHASE4`, `PHASE1, PHASE2`, `PHASE2, PHASE3`) and the API array form
    - Keyword matching including whole-word ALS, and no match on "also" or "deals"
    - Live normalization from the API v2 sample shape keeps only Massachusetts cities;
      slice normalization; missing fields become `""` or `[]`
    - `parseSliceCsv` on quoted titles with commas and doubled quotes; on the real
      `data/public/clinicaltrials-ma-recruiting-2026-10-18.csv`: 3,131 rows, and 5, 47 and
      21 matches for `huntington`, `familial_alzheimers` and `als`
    - `studyUrl` and `conditionSearchUrl` exact strings; `studyUrl("")` is null
    - _Requirements: 6.2, 6.3, 6.4, 7.2, 7.3, 7.4, 7.5, 7.6, 8.5, 8.6_

- [x] 3. [kiro] Implement the family module `lib/family.ts`
  - [x] 3.1 Implement access, selection and validation
    - Define `FAMILY_ENTRY_LIMIT = 40`, `FAMILY_ENTRY_KINDS` and the `FamilyAnswer` type
    - Implement `dontKnowAnswer(firstName)` ("I don't know how {first_name} would answer
      that.", "this person" when no first name), `familyModeAccess(digitalWill)` (trimmed
      non-empty strings from `family_mode_access`, `[]` for any other shape) and
      `isAllowedAsker(digitalWill, asker)` (exact match)
    - Implement `selectFamilyEntries(entries)`: allowed kinds only, newest `createdAt`
      first with `id` as tie-break, at most 40
    - Implement `validateFamilyAnswer(answer, entries, firstName)`: keep cited ids that
      equal an entry id, in input order, deduplicated, adding none; with none left,
      return the Dont_Know_Answer and `[]`; otherwise return the answer unchanged;
      non-array or non-string fields count as empty
    - No I/O, no model call
    - _Requirements: 9.1, 9.2, 9.4, 10.1, 10.2, 10.3, 10.4, 10.8_
  - [x] 3.2 Write property test P2 for `validateFamilyAnswer` (tests/pbt)
    - **Property P2: A family answer is cited or admits it does not know**: for arbitrary
      answers, cited ids mixing existing ids, unknown ids and duplicates, and arbitrary
      entry sets, the result is either the input answer unchanged with a non-empty,
      duplicate-free, order-preserving subsequence of existing input ids, or exactly the
      Dont_Know_Answer with no ids; applying it twice equals applying it once
    - **Validates: Requirements 10.1, 10.2, 10.3, 10.4**
  - [x] 3.3 Write property test P4 for `selectFamilyEntries` (tests/pbt)
    - **Property P4: Family entry selection never sends style examples**: for arbitrary
      entries across all five kinds, the result has at most 40 entries, none
      `style_example`, all from the input, and contains every allowed entry when there
      are 40 or fewer
    - **Validates: Requirements 9.2**
  - [x] 3.4 Write unit tests for `lib/family.ts`
    - `dontKnowAnswer("Maya")` exact text and the no-name case; `familyModeAccess` on
      Maya's `digital_will` returns `["Ella Linden (daughter)"]` and `[]` for null, a
      string, a non-array and non-string items; `isAllowedAsker` rejects near-misses
      (case, whitespace inside the name); selection order and tie-break
    - _Requirements: 9.1, 9.2, 10.2_

- [ ] 4. [kiro] Add the family-history relation to profiles
  - [x] 4.1 Write the migration `supabase/migrations/0004_care_outputs.sql`
    - Add the nullable `profiles.family_history_relation` column with a 1–40 character
      check; existing `profiles` RLS policies apply; renumber if task 1 found a
      different `health-baseline` migration number
    - _Requirements: 1.2_
  - [ ] 4.2 Thread the relation through the profile and the demo seed
    - Add `familyHistoryRelation?: string | null` to `Profile`; map the column in
      `SupabaseVaultRepository`; keep it in `InMemoryVaultRepository`
    - Add `"family_history_relation": "father"` to `data/synthetic/maya/profile.json` and
      read it in `mayaDemoProfile()`; extend the demo-start unit test to assert it
    - _Requirements: 1.2_

- [ ] 5. [kiro] Implement the clinician summary `lib/summary.ts`
  - [ ] 5.1 Implement `buildSummary` and the fixed texts
    - Define `SUMMARY_INTRO_TEXT`, `NOT_A_DIAGNOSIS_FOOTER`, `NO_CHANGE_TEXT`,
      `FOCUS_TEXT`, `NOT_AVAILABLE_TEXT`, `SYNTHETIC_LABEL`, `SUMMARY_FEATURE_ORDER` and
      the `SummaryInput`, `SummaryDeps`, `MeasureRow`, `SummaryField` and
      `ClinicianSummary` types
    - Implement `buildSummary(input, deps)` with `deps` defaulting to the real `gate`,
      `detectSignal`, `computeBaseline` and `zScores`: the 14 fields in order with the
      design's name, family-history and right-not-to-know rules; measures from
      `computeBaseline` (baseline window before the recent 4 weeks, and the recent 4-week
      window) and the latest-week `zScores` value, null when unavailable, with no target
      field; data sources with the synthetic rule (synthetic unless profile and every row
      are explicitly not synthetic)
    - Treat the gate as open only when a signal exists and `gate()` returns
      `includeInSummary === true` without throwing; otherwise field 10 is exactly
      `NO_CHANGE_TEXT` and the subject is "Update"; when open, field 10 uses the fixed
      template naming only measures, timeframe and z
    - Compute no mean or z locally; no I/O
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 4.4, 4.5_
  - [ ] 5.2 Write property test P3 for `buildSummary` (tests/pbt)
    - **Property P3: A closed gate hides change details**: for arbitrary weekly rows, an
      injected `detectSignal` returning an arbitrary signal or null, and an injected
      `gate` returning `includeInSummary: false`, a non-boolean, or throwing, field 10 is
      exactly "No change to report.", the subject is "Update", and no field contains the
      change description; repeat with the real `gate` for `record_only` and arbitrary
      values outside the three settings
    - **Validates: Requirements 3.2, 3.4, 3.5**
  - [ ] 5.3 Write unit tests for `buildSummary`
    - 14 fields in order with exact Intro and Footer; subject "iamyou Care Summary,
      Update, M. Linden" and "… Change noticed, …" when open; each missing-name case;
      field 6 "Familial Alzheimer's disease (father)"; six measure rows in order with no
      target key; null z with fewer than 12 prior weeks; open-gate text names only the
      signal's measures, the first week, the weeks since baseline start and z; synthetic
      true for Maya and for unknown flags; no field other than 6 names a condition and no
      field contains "likely", "risk" or "diagnosed"; identical output on repeat
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.1, 2.3, 2.4, 3.1, 3.3, 4.2, 4.3, 4.4, 4.5_

- [ ] 6. [kiro] Add the care-outputs zod schemas
  - Add to `lib/api-schemas.ts` (zod only): `SummaryRequestSchema` (`discuss` ≤ 500,
    `contact` ≤ 200, both optional), `SummaryResponseSchema` (14 fields with a
    discriminated `measures` entry, `synthetic`, `synthetic_label`), `TrialSchema`,
    `TrialsResponseSchema` (the `ok` / `no_matches` / `no_family_condition` union),
    `FamilyAskersResponseSchema`, `FamilyRequestSchema` (`asker` 1–200, `question`
    1–500) and `FamilyResponseSchema` (`asker`, `answer`, `cited_entries`,
    `synthetic_label`)
  - Add `familyAnswerSchemaFor(ids)` to `lib/claude/schemas.ts`
    (`cited_entry_ids: z.array(z.enum(ids))`)
  - _Requirements: 1.2, 5.7, 6.5, 7.1, 9.5_

- [ ] 7. Checkpoint: pure modules, properties, migration and schemas
  - Run `npm run lint`, `npm run test:unit` and `npm run test:pbt`; ensure all pass, ask
    the user if questions arise.

- [x] 8. [kiro] Implement the trials cache `lib/trials-cache.ts`
  - Define `TRIALS_CACHE_TTL_MS = 3_600_000`, `TrialsCacheEntry`, the `TrialsCache`
    interface and `InMemoryTrialsCache` (a `Map` keyed by condition that returns copies)
  - Unit test get/set, per-condition keys and copy semantics
  - _Requirements: 5.4, 5.5_

- [ ] 9. [kiro] Add `familyAnswer` to the server-only Claude layer
  - [ ] 9.1 Add the family prompts to `lib/claude/prompts.ts`
    - `FAMILY_ANSWER_SYSTEM` (answer as the person, first person and brief, only from the
      entries, cite every entry used, return exactly the Dont_Know_Answer when the
      entries do not support an answer, never speculate about health, diagnosis, genetic
      status or test results) and `buildFamilyAnswerUserMessage({ firstName, question,
      entries })` listing `[id] (kind) text`
    - _Requirements: 9.3, 10.7_
  - [ ] 9.2 Implement `familyAnswer` in `lib/claude/index.ts`
    - Return the Dont_Know_Answer without a call when `entries` is empty; otherwise
      `messages.parse` with model `"claude-opus-5-5"`, `effort: 'medium'` and
      `zodOutputFormat(familyAnswerSchemaFor(ids))`, no temperature/top_p/top_k, no
      prefill; check `stop_reason === 'refusal'` before reading; return the
      Dont_Know_Answer on refusal, parse failure or a 30-second timeout
    - Pass the result through `validateFamilyAnswer`, then screen surviving answers with
      `validateDraftSafety(answer, citedEntriesText)` and return the Dont_Know_Answer when
      it fails
    - _Requirements: 9.3, 9.5, 9.6, 9.7, 10.2, 10.7_
  - [ ] 9.3 Write unit tests for `familyAnswer` with a mocked client
    - Request shape (model, effort, enum of sent ids, one user message, no sampling
      params); empty entries make no call; refusal content is never read; timeout; a
      cited answer passes through; an answer adding a health term absent from the cited
      entries becomes the Dont_Know_Answer
    - _Requirements: 9.3, 9.4, 9.6, 9.7, 10.7_
  - [ ] 9.4 Extend property test P2 to `familyAnswer` (tests/pbt)
    - **Property P2: A family answer is cited or admits it does not know**: with a fake
      client returning arbitrary outputs (arbitrary text and ids, malformed output, or
      `stop_reason: 'refusal'`), `familyAnswer` returns either a non-empty set of existing
      cited ids or exactly the Dont_Know_Answer with none
    - **Validates: Requirements 9.5, 9.6, 10.1, 10.2**

- [ ] 10. [kiro] Implement `GET /api/trials` with unit tests
  - [ ] 10.1 Implement the route and exported `getTrials(deps, userId)`
    - Thin handler: authenticate (401), build `SupabaseVaultRepository`, the module-level
      `InMemoryTrialsCache`, the default `fetchLiveStudies`, a `readSlice` that reads
      `data/public/clinicaltrials-ma-recruiting-2026-10-18.csv`, and `Date.now`
    - Default `fetchLiveStudies`: `GET https://clinicaltrials.gov/api/v2/studies` with
      `query.cond = CONDITION_QUERY[condition]`, `query.locn = Massachusetts`,
      `filter.overallStatus = RECRUITING`, `fields =
      NCTId,BriefTitle,OverallStatus,Condition,Phase,LocationCity,LocationState`,
      `pageSize = 100`, the abort signal, and a throw on non-2xx
    - `getTrials`: no family condition → `no_family_condition` without a fetch; fresh
      cache → serve `cache`; otherwise fetch with a `timeoutMs` (default 10 000) abort
      plus race; on success check `{ studies: unknown[] }`, normalize as `live`,
      `filterTrials`, cache with `storedAt = now()`, serve `live` or `no_matches`; on
      error or timeout serve a stale cache entry, else parse, normalize, keyword-match and
      filter the slice, serving `saved_ma_slice` or `no_matches` with `NO_MATCH_TEXT` and
      `conditionSearchUrl`; an unreadable slice → 503 `trials_unavailable`
    - Validate the response with `TrialsResponseSchema`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 6.1, 6.2, 6.3, 6.4, 6.5_
  - [ ] 10.2 Write unit tests (in-memory repo, cache, fake fetch and clock)
    - Maya's profile requests `Alzheimer Disease` with the four query parameters; a
      missing or `none` family history makes no fetch; a cache hit under 3600 s makes no
      fetch and one at 3600 s fetches again; success caches and serves live trials
      without non-Massachusetts studies; zero studies → `no_matches`; an error and a
      timeout (small `timeoutMs`, never-resolving fetch) serve a stale cache entry, then
      the slice; slice results are RECRUITING with `["Massachusetts"]`; a slice with no
      matching row → `no_matches` with the exact text and search URL and an empty list;
      unreadable slice → 503
    - _Requirements: 5.1, 5.3, 5.4, 5.5, 5.6, 5.7, 6.1, 6.3, 6.4, 6.5_

- [ ] 11. [kiro] Implement `POST /api/summary` with unit tests
  - [ ] 11.1 Implement the route and exported `getSummary`
    - Thin handler: authenticate (401), validate with `SummaryRequestSchema` (400), build
      `SupabaseVaultRepository` and the `health-baseline` Supabase weekly feature
      repository, pass a server-clock `today`
    - `getSummary(vault, weekly, userId, body, today, deps?)`: 404 without a profile;
      otherwise `buildSummary` with the profile, the caller's weekly rows, `today()`,
      `discuss` and `contact`; set `synthetic_label` to "Synthetic data" when `synthetic`
      is true; validate with `SummaryResponseSchema`; store nothing and call no model
    - _Requirements: 1.7, 2.5, 3.4, 4.1, 4.2, 4.3, 4.6_
  - [ ] 11.2 Write unit tests (in-memory repos)
    - 404 without a profile; Maya with seeded synthetic rows returns 14 fields and the
      Synthetic_Label; `discuss` and `contact` appear in fields 11, 4 and 13 as written;
      `record_only` with an injected signal returns `NO_CHANGE_TEXT`; nothing is written
      to either repository
    - _Requirements: 1.2, 3.2, 4.2, 4.4_

- [ ] 12. [kiro] Implement `GET` and `POST /api/family` with unit tests
  - [ ] 12.1 Implement the route and exported `answerFamilyQuestion`
    - `GET`: authenticate (401), load the profile (404), respond `{ first_name, askers:
      familyModeAccess(digitalWill), synthetic_label }`
    - `POST`: validate with `FamilyRequestSchema` (400), then
      `answerFamilyQuestion(vault, claude, userId, body)`: 404 without a profile; 403
      `not_in_family_mode_access` when `isAllowedAsker` fails, before reading entries or
      calling Claude; `selectFamilyEntries`; no entries → Dont_Know_Answer without
      calling Claude; otherwise `validateFamilyAnswer(await claude.familyAnswer(...))`;
      respond with `asker`, `answer`, the cited entries (`id`, `kind`, `text`) in
      citation order and nothing else, and `synthetic_label`
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.7, 10.2, 10.3, 10.5, 10.6_
  - [ ] 12.2 Write unit tests (in-memory repo, mocked Claude)
    - `GET` for Maya returns `["Ella Linden (daughter)"]`; an unlisted asker gets 403 and
      no Claude call; a profile without `family_mode_access` refuses every asker; no
      allowed entries → Dont_Know_Answer and no call; `style_example` entries never
      reach Claude and at most 40 are sent; a mocked answer citing one real and one
      unknown id returns only the real entry's text; a mocked answer citing none returns
      the Dont_Know_Answer and no entries
    - _Requirements: 9.1, 9.2, 9.4, 10.2, 10.5, 10.6_

- [ ] 13. Checkpoint: routes, properties and unit tests
  - Run `npm run lint`, `npm run test:unit` and `npm run test:pbt`; ensure all pass, ask
    the user if questions arise.

- [ ] 14. [kiro] Boundary tests
  - Assert `lib/summary.ts`, `lib/trials.ts` and `lib/family.ts` import no `fs`,
    `next/*`, `@anthropic-ai/sdk` or `lib/claude`, and call no `fetch`; assert
    `@anthropic-ai/sdk` and `lib/claude` imports appear only under `app/api/` and
    `lib/claude/`; assert the ClinicalTrials.gov URL appears only in server code
  - _Requirements: 1.7, 5.8, 7.7, 9.7, 10.8_

## Notes

- All tasks are `[kiro]` and cover logic, migration, schemas, the Claude layer, routes and
  tests. The summary page, the trial list and the family mode screen are built by Claude
  Code and are not in this plan.
- Property tests P1 (2.2), P2 (3.2, 9.4), P3 (5.2), P4 (3.3) and P5 (2.3) are required.
- Task 1 resolves the known `health-baseline` mismatches (gate module path, recent-mean
  window) before task 5 is written.
- Commit messages follow `care-outputs {task}: {summary}`.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1", "2.1", "3.1", "4.1", "6", "8"] },
    { "id": 1, "tasks": ["2.2", "2.3", "2.4", "3.2", "3.3", "3.4", "4.2", "9.1"] },
    { "id": 2, "tasks": ["5.1", "9.2", "10.1"] },
    { "id": 3, "tasks": ["5.2", "5.3", "9.3", "9.4", "10.2", "11.1", "12.1"] },
    { "id": 4, "tasks": ["11.2", "12.2", "14"] }
  ]
}
```
