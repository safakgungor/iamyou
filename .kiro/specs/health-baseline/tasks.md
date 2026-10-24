# Implementation Plan: health-baseline

## Overview

This plan implements the `health-baseline` opt-in health layer on top of the existing
`twin-loop` and `assistant-tasks` codebase: deterministic speech features, a frozen
personal baseline evaluated in one chronological pass, a persistent multi-feature change
signal, the right-not-to-know gate, weekly sleep aggregation, the CDC PLACES county
lookup, the `weekly_features` table, Maya's reproducible 18-to-40 history, and the
`GET /api/timeline` and `GET /api/county` routes. Work proceeds bottom-up: the pure
`lib/fillers.ts` + `lib/speech-features.ts`, `lib/baseline.ts`, `lib/signal.ts` (detection
and the RTK gate), `lib/weekly.ts` and `lib/county.ts` modules with their property and
unit tests first, then the SQL migration, the weekly feature repository, the zod schemas
(including the `opted_in` discriminated union), the pure `lib/timeline.ts` shaping, the
seeded Maya generator with its calibration and determinism tests, the `seedDemo` and
`deleteVaultForUser` extensions, and finally the two new routes with unit tests.

`GET /api/timeline` enforces the health layer opt-in (Requirement 9, design D11): after
authentication it reads the caller's profile and, unless `health_layer_opt_in` is exactly
`true`, answers `{ "opted_in": false }` without reading any `weekly_features` row or
calling `detectSignal`.

Every task is tagged `[kiro]` and covers logic, database, scripts, schemas, routes, and
tests only. The React UI (the Timeline_Screen in `app/timeline/page.tsx`, its health layer
turn-on control, and the Context_Card) is built separately by Claude Code and is
intentionally excluded from this plan; the UI-only criteria 7.7–7.14, 8.6–8.11 and 9.5–9.6
(and the rendering side of 5.6–5.8) remain its acceptance contract and are consumed
through the API contracts built here. Every property test, P1–P18, is required; no task
is optional. No Claude call is added by this spec.

## Tasks

- [ ] 1. [kiro] Implement the speech feature modules `lib/fillers.ts` and `lib/speech-features.ts`
  - [ ] 1.1 Implement `lib/fillers.ts`
    - Export `FILLERS` as the ordered `as const` tuple `'um', 'uh', 'er', 'like',
      'you know', 'i mean', 'basically', 'actually'` and the `Filler` type
    - Export `MULTI_WORD_FILLERS` (`{'you know', 'i mean'}`) and `SINGLE_WORD_FILLERS`
      (the six one-word fillers) as `ReadonlySet<string>` derived from `FILLERS`
    - No I/O, no imports beyond types
    - _Requirements: 1.5, 1.6_
  - [ ] 1.2 Implement `lib/speech-features.ts`
    - Export the `SpeechFeatures` type, `MATTR_WINDOW = 50`, `tokenize(text)`,
      `splitSentences(text)` and `extractSpeechFeatures(transcript)` with the exact
      signatures from the design
    - `tokenize`: `toLowerCase()` (never `toLocaleLowerCase`), split on `/\s+/`, trim
      leading/trailing non-letter/non-digit characters with
      `/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu`, drop empty chunks
    - `vocabulary_diversity`: sliding-count-map MATTR over every 50-token window when
      `n >= 50`, plain `distinct / n` when `1 <= n < 50`
    - `mean_sentence_length`: split the original transcript on `/[.!?]/`, tokenize each
      segment, drop zero-token segments, mean token count
    - `filler_rate`: left-to-right scan matching a two-word pair in `MULTI_WORD_FILLERS`
      first (advance by 2), else a single token in `SINGLE_WORD_FILLERS` (advance by 1);
      `count / n * 100`
    - Return all three as `0` when there are zero tokens or zero non-empty sentences,
      before any division; no model call, no I/O, no input mutation
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.7, 1.8, 1.9_
  - [ ] 1.3 Write property test P4 in `tests/pbt/speech-features.test.ts`
    - **Property P4: Speech features are deterministic and bounded** — for any transcript
      string (including empty, whitespace-only and punctuation-only strings, generated with
      `fc.string({ unit: 'grapheme' })` plus explicit whitespace/punctuation strings), two
      calls return identical values, `vocabulary_diversity` is in `[0, 1]`, `filler_rate`
      is `>= 0`, every value is finite, and zero tokens or zero non-empty sentences yield
      all three values `0`
    - Tag comment `// Feature: health-baseline, Property 4: …` and a `Validates:` line
    - **Validates: Requirements 1.7, 1.8, 1.9**
  - [ ] 1.4 Write property test P8 in `tests/pbt/speech-features.test.ts`
    - **Property P8: Speech features follow their definitions** — for word lists (length
      0–120) drawn from a filler-heavy vocabulary including the parts of `you know` and
      `i mean`, joined with arbitrary whitespace, mixed case and `.!?` runs that create
      empty segments, `extractSpeechFeatures` equals a naive reference implementation of
      MATTR / plain TTR, mean non-empty sentence length, and the two-word-first filler
      scan; changing the case of the transcript does not change the result
    - Add as a second `it(...)` in the same file as P4, with its own tag comment
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5**
  - [ ] 1.5 Write unit tests in `tests/unit/speech-features.test.ts`
    - Assert `FILLERS` equals the eight strings in order; `"you know like"` counts 2
      fillers in 3 tokens; `"um, I mean... like."` tokenizes to
      `["um","i","mean","like"]`; `""`, `"   "` and `"?!."` return all zeros; a 60-token
      sample matches a hand-computed MATTR value
    - _Requirements: 1.2, 1.5, 1.6, 1.7_

- [ ] 2. [kiro] Implement the frozen-baseline pure module `lib/baseline.ts`
  - [ ] 2.1 Implement constants, types, helpers and the shared run detector
    - Export `FEATURES` (canonical order), `Feature`, and the constants
      `Z_THRESHOLD = 2.0`, `WEEKS_REQUIRED = 3`, `FEATURES_REQUIRED = 2`,
      `MIN_BASELINE_WEEKS = 12`, `SD_FLOOR = 1e-6`, defined together
    - Export the types `WeeklyFeatureRow`, `WeeklyFeatureInput`, `FeatureZ`,
      `WeekZScores`, `BaselineStats`, `Baseline`, `ChangeSignal`
      (`{ features, firstWeek, detectedWeek }`), `RunState` and `HistoryEvaluation` exactly
      as in the design
    - Implement `canonicalOrder` (returns a sorted copy by `weekStart`, ties broken by the
      `FEATURES.map(f => String(featureValue(row, f))).join('|')` key), `featureValue`
      (finite number or `null`; `null`, `undefined`, `NaN`, `±Infinity` → `null`, never
      `0`), `meanAndPopSd` (divides by `n`), and a private `Date.UTC`-based `daysBetween`
      (unparsable dates give `NaN`, never 7)
    - Implement `initialRunState`, `advanceRuns` (consecutive only when exactly 7 days
      apart; a gap, a null z or `|z| < Z_THRESHOLD` resets a run; either sign counts; the
      signal is set once at the earliest qualifying week with `features` in canonical order
      and `firstWeek` = earliest run start) and
      `signalFromZScores(weeks) = weeks.reduce(advanceRuns, initialRunState()).signal`
    - No I/O, no environment reads, no input mutation, no import from `lib/signal.ts`
    - _Requirements: 3.1, 3.4, 3.13, 4.3, 4.4, 4.9_
  - [ ] 2.2 Implement `evaluateHistory`, `zScores`, `computeBaseline` and `recentMean`
    - Implement the single chronological pass of the design: for each week of
      `canonicalOrder(rows)`, (a) compute z-scores against the baseline sets as they stand
      before W (`null` for missing values and for weeks in a feature's initial set;
      `(v − mean) / Math.max(sd, SD_FLOOR)` otherwise), (b) fold `advanceRuns` to get the
      open-signal state (`openAt`), (c) append initial-set values unconditionally and later
      values only when no signal is open and no z-score of W has `|z| >= Z_THRESHOLD`
    - Return `{ weeks, baseline, signal, openAt }`; `baseline[f]` is `null` when the
      feature has fewer than 12 non-null weeks, else `{ mean, sd, weeks }` of the final set
    - Export `zScores = (rows) => evaluateHistory(rows).weeks` and
      `computeBaseline = (rows) => evaluateHistory(rows).baseline`; `zScores([])` is `[]`
    - Implement `recentMean(rows, feature, windowWeeks = 4)` over rows with `weekStart` in
      `(latest − 7·windowWeeks days, latest]`, returning `null` when none has a value
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 3.14, 3.15_
  - [ ] 2.3 Implement the shared fast-check arbitraries `tests/pbt/helpers/weekly-rows.ts`
    - Export `weeklyRowsArb({ minWeeks, maxWeeks, nullRate, gapRate, duplicateRate })`
      (7-day steps from a random start date, random 14+ day gaps, optional duplicates,
      per-feature nulls/missing keys, occasional non-finite values), `stableThenSpikeArb`
      (12 initial weeks alternating `c ± d`, later weeks alternating `c ± d`, exactly one
      spike week at `c ± k·d` with `k >= 3` for a random non-empty feature subset),
      `driftArb` (stable history then a sustained shift in 2–6 features for 3–10 weeks),
      and `permutationArb(rows)` (`fc.shuffledSubarray` at full length)
    - Add a `deepFreeze` helper for the no-mutation checks
    - Export `countingWeeklyRepo(inner)`, wrapping an `InMemoryWeeklyFeatureRepository`
      (task 8.1) and counting `listWeeklyFeatures` calls in `.listCalls`, so P18 and the
      Req 9.7 unit tests can assert that no weekly row was read
    - _Requirements: 3.2, 4.6, 4.8, 9.2, 9.7_
  - [ ] 2.4 Write property test P9 in `tests/pbt/baseline-order-independent.test.ts`
    - **Property P9: History evaluation is order-independent and well-shaped** — for any
      rows from `weeklyRowsArb` (nulls, missing keys, gaps and duplicate weeks allowed) and
      any permutation, `zScores` and `computeBaseline` return deep-equal results;
      `zScores(rows)` has one entry per input row in ascending `weekStart` order, each with
      all six feature keys as a finite number or explicit `null`, and `zScores([])` is `[]`
    - **Validates: Requirements 3.2, 3.15**
  - [ ] 2.5 Write property test P11 in `tests/pbt/baseline-frozen.test.ts`
    - **Property P11: The frozen baseline never absorbs deviating or post-signal weeks** —
      over `weeklyRowsArb` ∪ `driftArb` ∪ constant columns, a naive reference rebuild of each
      feature's baseline set from the sorted rows reproduces every z-score and the final
      `computeBaseline` statistics within a relative tolerance of `1e-9`: the first 12
      non-null values form the initial set with no z-score; nulls are skipped, never 0;
      later z-scores use only earlier weeks (population SD, `SD_FLOOR`); later values are
      appended only when no z-score of the week has `|z| >= Z_THRESHOLD` and
      `openAt[i]` is `false`; features with fewer than 12 non-null weeks have no z-score
      and a `null` baseline
    - **Validates: Requirements 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12**
  - [ ] 2.6 Write unit tests in `tests/unit/baseline.test.ts`
    - Assert the constants equal 2.0 / 3 / 2 / 12; exactly 12 non-null weeks give no
      z-score but a non-null baseline and 11 give a `null` baseline; a constant initial set
      gives `z = 0` for an equal value and a large finite z otherwise; a null week is
      skipped, not zeroed; a deviating week leaves the baseline stats unchanged;
      `recentMean` over the last 4 weeks, and `null` with no data
    - _Requirements: 3.4, 3.6, 3.7, 3.9, 3.11, 3.13_

- [ ] 3. [kiro] Implement change-signal detection and the RTK gate `lib/signal.ts`
  - [ ] 3.1 Implement `lib/signal.ts`
    - Re-export `Z_THRESHOLD`, `WEEKS_REQUIRED`, `FEATURES_REQUIRED`,
      `MIN_BASELINE_WEEKS` and the `ChangeSignal` / `Feature` types with
      `export { … } from './baseline'` (same bindings, never redefined)
    - Implement `detectSignal(rows) = signalFromZScores(zScores(rows))`, taking every
      z-score from `zScores(rows)` without recomputing it; no I/O, no input mutation
    - Export `GateResult` and implement `gate(signal, rtk_setting: unknown)` as a `switch`
      on `===`: `tell_me` → `{ true, true }`, `doctor_only` → `{ false, true }`,
      `record_only` and every other value (other case, whitespace, `null`, `undefined`,
      numbers, objects) → `{ false, false }`; the result depends only on `rtk_setting` and
      it never throws
    - `gate` is defined and exported only here; no other module re-exports or
      reimplements it, and every consumer imports it from `lib/signal.ts`
    - _Requirements: 4.1, 4.2, 4.5, 4.6, 4.7, 4.8, 5.1, 5.2, 5.3, 5.4, 5.5_
  - [ ] 3.2 Write property test P1 in `tests/pbt/signal-single-spike.test.ts`
    - **Property P1: A single spike never signals** — over `stableThenSpikeArb` rows,
      shuffled, first assert through `zScores` that exactly one week has any
      `|z| >= Z_THRESHOLD`, then assert `detectSignal(rows)` is `null`
    - **Validates: Requirements 4.6**
  - [ ] 3.3 Write property test P2 in `tests/pbt/gate.test.ts`
    - **Property P2: `record_only` hides everywhere** — for any `ChangeSignal | null`,
      `gate(signal, 'record_only')` returns `{ showToUser: false, includeInSummary: false }`
    - **Validates: Requirements 5.4**
  - [ ] 3.4 Write property test P3 in `tests/pbt/gate.test.ts`
    - **Property P3: `doctor_only` hides from the user** — for any `ChangeSignal | null`,
      `gate(signal, 'doctor_only')` returns `showToUser: false` and
      `includeInSummary: true`
    - Add as a second `it(...)` in the same file as P2
    - **Validates: Requirements 5.3**
  - [ ] 3.5 Write property test P7 in `tests/pbt/gate.test.ts`
    - **Property P7: The gate is total and fails closed** — for any `ChangeSignal | null`
      and any value from `fc.anything()` plus near-miss strings (`'TELL_ME'`,
      `' tell_me'`, `''`), `gate` returns `{ true, true }` exactly for `'tell_me'`,
      `{ false, false }` for every value that is not one of the three settings, and never
      throws
    - Add as a third `it(...)` in the same file as P2 and P3
    - **Validates: Requirements 5.1, 5.2, 5.5**
  - [ ] 3.6 Write property test P5 in `tests/pbt/signal-order-independent.test.ts`
    - **Property P5: Detection is order-independent** — for rows with distinct
      `week_start` values from `weeklyRowsArb` ∪ `driftArb` and two permutations, both
      results are `null` or both are signals with identical `features` (same order),
      `firstWeek` and `detectedWeek`
    - **Validates: Requirements 4.8**
  - [ ] 3.7 Write property test P6 in `tests/pbt/signal-min-history.test.ts`
    - **Property P6: Not enough history, no signal** — for any history with 0–11 distinct
      `week_start` values (duplicates allowed) and any feature values including extreme
      ones, `detectSignal(rows)` returns `null`
    - **Validates: Requirements 4.7**
  - [ ] 3.8 Write property test P10 in `tests/pbt/signal-agreement.test.ts`
    - **Property P10: Detection agrees with the pass** — for deep-frozen rows from
      `weeklyRowsArb` ∪ `driftArb`, `detectSignal(rows)` deep-equals
      `evaluateHistory(rows).signal`, and every `evaluateHistory(rows).openAt[i]` equals
      `signalFromZScores(zScores(rows).slice(0, i + 1)) !== null`; neither call mutates
      the input
    - **Validates: Requirements 3.14, 4.2**
  - [ ] 3.9 Write property test P12 in `tests/pbt/signal-well-formed.test.ts`
    - **Property P12: A change signal is well-formed and earliest** — with an independent
      run counter over `zScores(rows)` defining `Q(W)` (features deviating in at least 3
      consecutive 7-day-apart weeks ending at W, no null z), `detectSignal` is `null`
      exactly when no week has `|Q(W)| >= 2`; otherwise `detectedWeek` is the earliest
      such W, `features` is `Q(W)` in canonical `FEATURES` order, and `firstWeek` is the
      earliest start of the listed features' runs ending at W
    - **Validates: Requirements 4.3, 4.4, 4.5, 4.9**
  - [ ] 3.10 Write unit tests in `tests/unit/signal.test.ts`
    - Assert each re-exported constant is `===` its `lib/baseline.ts` counterpart;
      a two-feature, three-week shift yields one signal with the expected
      `features` / `firstWeek` / `detectedWeek`; a two-week shift or a 14-day gap inside
      the run yields `null`; a later second episode does not produce a second signal;
      `[]` yields `null`; the gate truth table for the three settings
    - _Requirements: 4.1, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 5.4_

- [ ] 4. [kiro] Implement weekly sleep aggregation `lib/weekly.ts`
  - [ ] 4.1 Implement `weeklySleepHours`
    - Export `DailyWearableRow` and `weeklySleepHours(dailyRows)`: the mean of the finite
      `sleep_hours` values; missing, `null` and non-finite values are excluded from both
      the sum and the count, never treated as 0; `null` when no day has a value; no I/O
    - _Requirements: 6.10, 6.11, 6.12, 6.13_
  - [ ] 4.2 Write property test P14 in `tests/pbt/weekly-sleep.test.ts`
    - **Property P14: Weekly sleep ignores missing days** — for daily rows whose
      `sleep_hours` is a finite number, `null` or absent, the result is `null` when no day
      has a value and otherwise the arithmetic mean of exactly the valued days (within
      `1e-9`); inserting any number of null or missing days anywhere does not change it
    - **Validates: Requirements 6.11, 6.12, 6.13**
  - [ ] 4.3 Write unit tests in `tests/unit/weekly.test.ts`
    - Assert `[7, null, 8]` → `7.5`; `[]` and all-null → `null`
    - _Requirements: 6.11, 6.12, 6.13_

- [ ] 5. [kiro] Implement the county CSV lookup `lib/county.ts`
  - [ ] 5.1 Implement `parseShortSleepCsv`, `toCountyCard` and `findCountyCard`
    - Export `ShortSleepCsvRow` and `CountyCard`; `parseShortSleepCsv` strips a leading
      BOM, splits on `/\r?\n/`, drops trailing empty lines, maps the six required columns
      by header name in any order (missing column → `null`), skips lines whose cell count
      differs from the header's, and keeps cells unchanged
    - `toCountyCard`: `year` matches `/^\d{4}$/`; `prevalence`, `low`, `high` match
      `/^\d+(\.\d+)?$/`, are finite in `[0, 100]` and satisfy `low <= prevalence <= high`;
      otherwise `null`; `population` is never read into the card
    - `findCountyCard(rows, county: unknown)`: requires a non-empty string and exactly one
      case-sensitive `row.county === county` match (zero or ambiguous → `null`), then
      `toCountyCard`
    - No I/O; the file read stays in the route module
    - _Requirements: 8.1, 8.2, 8.3, 8.12_
  - [ ] 5.2 Write property test P15 in `tests/pbt/county.test.ts`
    - **Property P15: County CSV parsing round-trips** — for rows whose cells contain no
      comma, CR or LF, printing them with a local test helper `formatShortSleepCsv`
      (header in any column order, LF or CRLF endings) and parsing with
      `parseShortSleepCsv` returns the same rows with every cell unchanged
    - **Validates: Requirements 8.1, 8.2**
  - [ ] 5.3 Write property test P16 in `tests/pbt/county.test.ts`
    - **Property P16: County lookup is exact and fails closed** — for tables with valid,
      invalid and duplicate counties and queries including case variants, `null`, `''`
      and non-strings, `findCountyCard` returns a card exactly when the query equals the
      `county` of exactly one row with valid values; the card holds exactly `county`,
      `year`, `prevalence`, `low`, `high` equal to `Number` of the source cells and never
      `population`; every other case returns `null`
    - Add as a second `it(...)` in the same file as P15
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.12**

- [ ] 6. Checkpoint - Ensure all pure-module property and unit tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. [kiro] Write the SQL migration `supabase/migrations/0003_health_baseline.sql`
  - [ ] 7.1 Create the `weekly_features` table with RLS
    - Header comment in the style of 0001/0002 listing the requirements
    - Columns `user_id uuid not null references auth.users on delete cascade`,
      `week_start date not null`, the six nullable `numeric` feature columns, and
      `synthetic boolean not null default false`; constraint
      `weekly_features_user_week_unique unique (user_id, week_start)`
    - Enable RLS with `weekly_features_select` / `_insert` / `_update` / `_delete` policies
      keyed on `user_id = auth.uid()` (update with both `using` and `with check`); do not
      alter the `twin-loop` or `assistant-tasks` tables
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_
  - [ ] 7.2 Write a static migration test in `tests/unit/migration-health-baseline.test.ts`
    - Read the SQL file as text and assert the `weekly_features` table declares exactly the
      Req 2.1 columns, the `unique (user_id, week_start)` constraint, `enable row level
      security`, and four select/insert/update/delete policies each keyed on
      `user_id = auth.uid()`; no live database is used
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [ ] 8. [kiro] Implement the weekly feature repository `lib/db/weekly-feature-repository.ts`
  - [ ] 8.1 Define `WeeklyFeatureRepository` and `InMemoryWeeklyFeatureRepository`
    - Interface methods `listWeeklyFeatures(userId)` (ascending `weekStart`),
      `upsertWeeklyFeatures(userId, rows)` (insert-or-replace on `(userId, weekStart)`)
      and `deleteForUser(userId)`, using `WeeklyFeatureRow` from `lib/baseline.ts`
    - `InMemoryWeeklyFeatureRepository` backed by
      `Map<userId, Map<weekStart, WeeklyFeatureRow>>`; returns sorted copies so callers
      cannot mutate stored rows; `deleteForUser` drops only that user's inner map
    - _Requirements: 2.3, 2.4, 2.10, 2.11, 7.1_
  - [ ] 8.2 Implement `SupabaseWeeklyFeatureRepository`
    - Runs on an injected `SupabaseClient`; every statement filters by
      `user_id = userId`; maps `week_start` ↔ `weekStart`
    - `upsertWeeklyFeatures` sends chunks of 500 rows with
      `upsert(rows, { onConflict: 'user_id,week_start' })`; `listWeeklyFeatures` orders by
      `week_start` ascending and pages with `.range()` in pages of 1,000; `deleteForUser`
      issues one delete filtered by `user_id`
    - Export `toNullableNumber` (number or numeric string → number; anything else → `null`)
      for the `numeric` columns
    - _Requirements: 2.4, 2.5, 2.10, 2.11, 7.1_
  - [ ] 8.3 Write unit tests in `tests/unit/weekly-feature-repository.test.ts`
    - Assert upserting the same rows twice yields no duplicates; the list is sorted by
      `weekStart` and scoped to the owner; returned rows are copies; `deleteForUser`
      leaves other users intact; `toNullableNumber("7.31")` is `7.31` and
      `toNullableNumber(null)` is `null`
    - _Requirements: 2.3, 2.4, 2.10, 2.11, 7.1_

- [ ] 9. [kiro] Add the timeline and county zod schemas to `lib/api-schemas.ts`
  - Add (zod only, no server imports) `FeatureNameSchema` mirroring `FEATURES`,
    `TimelineRowSchema`, `TimelineZScoresSchema`, `BaselineStatsSchema` and
    `ChangeSignalResponseSchema` (`features` min 2, `first_week`, `detected_week`), all
    `.strict()` as in the design
  - Add `TimelineOptedOutSchema` (`.strict()`, only `opted_in: z.literal(false)`, no
    other key) and `TimelineOptedInSchema` (`.strict()`, keys in order
    `opted_in: z.literal(true)` first, then `rtk_setting` nullable, `rows`, `z_scores`,
    `baseline`, and `signal` always present and nullable)
  - Add `TimelineResponseSchema = z.discriminatedUnion('opted_in',
    [TimelineOptedOutSchema, TimelineOptedInSchema])` and the types `TimelineResponse`
    and `TimelineOptedIn` (D11)
  - Add `CountyCardSchema` (`.strict()` with the `low <= prevalence <= high` refine),
    `CountyResponseSchema` (union of `{ available: true, card }` and
    `{ available: false }`, both `.strict()`) and the `CountyResponse` type
  - Re-export the new schemas and types from `lib/claude/schemas.ts` for server use, as the
    existing routes do
  - _Requirements: 7.2, 7.6, 8.2, 8.3, 8.5, 8.13, 9.1, 9.3, 9.4_

- [ ] 10. [kiro] Implement pure timeline shaping `lib/timeline.ts`
  - [ ] 10.1 Implement `buildTimeline(rows, rtkSetting: unknown): TimelineOptedIn`
    - Shapes only the opted-in branch (called by `getTimeline` after the opt-in check);
      the returned object has `opted_in: true` as its first key, then `rtk_setting`,
      `rows`, `z_scores`, `baseline`, `signal`
    - Build `rows` (snake_case `week_start`, six features, `synthetic`) from
      `canonicalOrder(rows)`, `z_scores` from `zScores(rows)` with explicit nulls,
      `baseline[f]` as `{ mean, sd }` or `null` from `computeBaseline(rows)`, and
      `rtk_setting` echoed only when it is a valid setting (else `null`)
    - Set `signal` to `{ features, first_week, detected_week }` only when
      `detectSignal(rows)` is non-null and `gate(signal, rtkSetting).showToUser === true`;
      otherwise `signal: null` through the same code path, so a gated signal is
      byte-identical to no signal; fixed key order for deterministic JSON
    - _Requirements: 5.6, 5.7, 7.1, 7.2, 7.3, 7.4, 7.15, 9.3_
  - [ ] 10.2 Write property test P13 in `tests/pbt/timeline-no-leak.test.ts`
    - **Property P13: The timeline never leaks a gated signal** — over `weeklyRowsArb`
      (distinct weeks, may be empty) ∪ `driftArb` × `fc.oneof(the three settings,
      fc.anything())`: a gated signal produces `JSON.stringify` output identical to the
      no-signal response; no signal gives `signal: null`; a shown signal carries exactly
      its features, first week and detected week; `z_scores` matches `zScores(rows)` with
      explicit nulls; `baseline[f]` is `null` exactly below 12 non-null weeks; `rows` are
      in ascending `week_start` order; the result has `opted_in: true` as its first key
      and always passes `TimelineOptedInSchema` (the opted-in branch of
      `TimelineResponseSchema`)
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.15, 9.3**

- [ ] 11. Checkpoint - Ensure migration, repository, schema, and timeline tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 12. [kiro] Implement Maya's reproducible history `scripts/generate-maya.ts`
  - [ ] 12.1 Implement the seeded generator
    - Self-contained: import only `node:fs`, `node:path`, `node:url`; use only
      `+ - * /`, `Math.imul`, bit shifts and `Number.prototype.toFixed` (no `Math.pow`,
      `Math.exp`, `**`, `Math.random`, `Date.now`, `toLocale*`, `process.env`)
    - Export `MAYA_SEED = 20261024`, `mulberry32(seed)`, `simulatedAge(startDate,
      through, weekStart)`, `driftFraction(age)` (0 below 38.5, `x·x·x·x` with
      `x = min(1, (age − 38.5) / 1.5)`), `generateMayaWeeklyFeatures(profile)` and
      `serializeWeeklyFeatures(rows)`
    - Weeks `start_date + 7k` days (UTC) for `k = 0 … 1148`; one draw per feature per week
      in `FEATURES` order; `value = clamp_f(base_f + a_f·u + dir_f·4·a_f·s(age))`, rounded
      with `Number(x.toFixed(decimals))`, using the design's per-feature `base_f`, `a_f`,
      `dir_f`, decimals and clamp table; every row `synthetic: true`
    - Fixed key order per row; output is `JSON.stringify(rows, null, 2) + '\n'` (LF,
      UTF-8); `main()` reads `data/synthetic/maya/profile.json` and writes
      `data/synthetic/maya/weekly-features.json`, and runs only when the file is executed
      directly (`import.meta.url === pathToFileURL(process.argv[1]).href`)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.8_
  - [ ] 12.2 Add the npm script and generate the committed data file
    - Add `"generate:maya": "node scripts/generate-maya.ts"` to `package.json` scripts
      (leave all other scripts and dependencies unchanged)
    - Run `npm run generate:maya` to write `data/synthetic/maya/weekly-features.json`
      (1,149 rows, 2026-10-24 through 2048-10-24 inclusive)
    - _Requirements: 6.1, 6.3, 6.8_
  - [ ] 12.3 Write the calibration test `tests/unit/maya-calibration.test.ts`
    - Over the committed `weekly-features.json`: 1,149 rows; first `week_start` =
      profile `start_date`, last = `simulated_through`, every step exactly 7 days; every
      row `synthetic: true`; below age 38.5 each value is within `a_f` (plus rounding) of
      `base_f`; `driftFraction` is non-decreasing on a fine age grid and the deviation at
      `simulated_through` exceeds that at 38.5 for the four drifting features
    - Assert `detectSignal(rows)` is non-null with
      `39 <= simulatedAge(detectedWeek) < 40`, and `detectSignal` over only the rows
      before age 39 is `null`
    - If calibration fails, adjust the generator parameters within the design's model and
      regenerate the file (12.2) until it passes
    - _Requirements: 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9_
  - [ ] 12.4 Write the determinism test `tests/unit/maya-generate.test.ts`
    - Assert two calls of `serializeWeeklyFeatures(generateMayaWeeklyFeatures(profile))`
      return identical strings equal byte-for-byte to the committed file (read as a
      `Buffer`); a source scan asserts the script contains no `Date.now`, argument-less
      `new Date()`, `Math.random`, `toLocale`, `process.env`, `Math.pow`, `Math.exp` or
      `**`; importing the module writes no file
    - _Requirements: 6.1, 6.2_

- [ ] 13. [kiro] Extend `POST /api/demo/start` to seed weekly features
  - [ ] 13.1 Extend `seedDemo` and the handler in `app/api/demo/start/route.ts`
    - Add `mayaDemoWeeklyFeatures()` importing `@/data/synthetic/maya/weekly-features.json`
      like the existing profile/vault imports, mapping `week_start` → `weekStart` and
      forcing `synthetic: true`
    - Change the signature to `seedDemo(repo, weeklyRepo, userId, profile, entries,
      weeklyRows)` and call `weeklyRepo.upsertWeeklyFeatures(userId, weeklyRows)` after the
      vault upserts, so the rows are owned by the caller
    - In `POST`, build `new SupabaseWeeklyFeatureRepository(serviceClient)` on the existing
      service-role client and pass `mayaDemoWeeklyFeatures()`; the service-role key stays
      read only in this route; a failure keeps mapping to 500
    - _Requirements: 2.7, 2.8, 2.9, 2.10_
  - [ ] 13.2 Update `tests/unit/demo-start.test.ts`
    - Update existing calls to the new signature with an `InMemoryWeeklyFeatureRepository`
      and keep the vault assertions; assert after `seedDemo` the caller owns 1,149 weekly
      rows, all `synthetic: true`, with dates equal to the file, and no other user owns
      any; a second call still yields 1,149; a throwing weekly repo makes `seedDemo` reject
    - _Requirements: 2.7, 2.10_

- [ ] 14. [kiro] Extend `DELETE /api/vault` to delete weekly features
  - [ ] 14.1 Extend `deleteVaultForUser` in `app/api/vault/route.ts`
    - Change the signature to `deleteVaultForUser(repo, draftRepo, weeklyRepo, userId)`
      and call `weeklyRepo.deleteForUser(userId)` after the vault and draft deletes;
      update the header comment
    - In `DELETE`, add `new SupabaseWeeklyFeatureRepository(supabase)` on the
      request-scoped client so RLS scopes the delete to the caller
    - The existing callers are updated in 14.2 and 14.3
    - _Requirements: 2.11_
  - [ ] 14.2 Extend the delete-vault property in `tests/pbt/delete-vault.test.ts` (P17)
    - **Property P17: Deleting a vault also deletes weekly features (extends twin-loop
      P4)** — keep the `// Feature: twin-loop, Property 4: …` header and add
      `// Feature: health-baseline, Property 17: Deleting a vault also deletes weekly
      features`; extend `UserSeed` with `weeklyRows`, seed an
      `InMemoryWeeklyFeatureRepository`, call the four-argument `deleteVaultForUser`, and
      assert the target's `listWeeklyFeatures` is `[]` while every other user's weekly
      rows (and existing vault and draft rows) deep-equal their snapshot
    - **Validates: Requirements 2.11**
  - [ ] 14.3 Update `tests/unit/vault-delete.test.ts`
    - Update calls to the four-argument signature; assert the caller's weekly rows are
      removed and another user's are kept
    - _Requirements: 2.11_

- [ ] 15. [kiro] Implement `GET /api/timeline` with unit tests
  - [ ] 15.1 Implement `app/api/timeline/route.ts` and the exported `getTimeline`
    - Export `ProfileReader = Pick<VaultRepository, 'getProfile'>`, `TimelineOutcome`
      (200 with either branch of `TimelineResponse`, or 503
      `{ error: 'timeline_unavailable' }`) and `getTimeline(weekly, profiles, userId)`
    - Implement the exact D11 order: (1) `profiles.getProfile(userId)`; a throw → 503
      `{ error: 'timeline_unavailable' }` with no `opted_in` key and no weekly read;
      (2) if there is no profile or `profile.healthLayerOptIn !== true` (`false`, `null`,
      `undefined`, any non-boolean), return 200 with `TimelineResponseSchema.safeParse({
      opted_in: false })` data (parse failure → 503) without calling
      `weekly.listWeeklyFeatures`, `buildTimeline` or `detectSignal`;
      (3) `weekly.listWeeklyFeatures(userId)`; a throw → 503, nothing partial;
      (4) `buildTimeline(rows, profile.rtkSetting)` with the setting read at request time;
      (5) `TimelineResponseSchema.safeParse` failure → 503 `timeline_unavailable`, else 200
      with the parsed body
    - `detectSignal` is reached only through `buildTimeline`, which is called only in
      step 4
    - Thin `GET` handler: `createSupabaseServerClient()` + `auth.getUser()` first, 401
      `{ error: 'Unauthorized' }` with no data and no profile read when there is no user;
      otherwise wire `SupabaseWeeklyFeatureRepository` and `SupabaseVaultRepository` on
      the request-scoped client and return the outcome's status and body
    - _Requirements: 5.6, 5.7, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.15, 7.16, 9.1, 9.2, 9.3, 9.4_
  - [ ] 15.2 Write property test P18 in `tests/pbt/timeline-opt-in.test.ts`
    - **Property P18: Opted-out callers get nothing** — for any caller whose profile is
      absent or has `healthLayerOptIn` ∈ {`false`, `null`, `undefined`}, any
      `rtk_setting`, and any weekly rows stored for that caller (`weeklyRowsArb` ∪
      `driftArb`, may be empty, including signal-producing histories) in a
      `countingWeeklyRepo` over `InMemoryWeeklyFeatureRepository`,
      `getTimeline(countingWeeklyRepo, profiles, userId)` returns status 200 with a body
      that deep-equals `{ opted_in: false }`, whose JSON is exactly `{"opted_in":false}`,
      and the repository's `listWeeklyFeatures` call count is `0`
    - Tag comment `// Feature: health-baseline, Property 18: …` and a `Validates:` line
    - **Validates: Requirements 9.1, 9.2, 9.4**
  - [ ] 15.3 Write unit tests in `tests/unit/timeline-route.test.ts`
    - All cases use `countingWeeklyRepo` over `InMemoryWeeklyFeatureRepository` and
      `InMemoryVaultRepository`
    - (a) No profile: status 200, body deep-equals and JSON-equals `{"opted_in":false}`,
      `listWeeklyFeatures` called 0 times
    - (b) `healthLayerOptIn: false` with Maya's 1,149 rows (`mayaDemoWeeklyFeatures()`)
      seeded in the in-memory repo: body exactly `{"opted_in":false}`,
      `listWeeklyFeatures` called 0 times
    - (c) Profile read throws: 503 `{ error: 'timeline_unavailable' }`, the body has no
      `opted_in` key, and `listWeeklyFeatures` is called 0 times
    - (d) Opted-in happy path: body has `opted_in: true` as its first key and returns only
      the caller's rows, sorted, when another user also has rows; Maya's seeded history
      with `tell_me` includes a signal
    - Gated signal: the same opted-in rows with `doctor_only`, `record_only`, `null` and an
      invalid setting give `signal: null` with otherwise identical JSON
    - Weekly read failure: a throwing weekly repo → 503 with no data; also opted in with
      zero rows → `opted_in: true`, `rows: []`, `z_scores: []`, all baselines `null`,
      `signal: null`; a row with an invalid `weekStart` → 503 with no data
    - Schema: `TimelineResponseSchema` accepts `{ opted_in: false }` and rejects
      `{ opted_in: false, rows: [] }` and `{ opted_in: false, signal: null }`
    - A passthrough `vi.mock` spy on `buildTimeline` (the only path to `detectSignal`)
      records 0 calls in the opted-out cases
    - Handler-level test with a mocked `@/lib/db/supabase-server` returns 401 and no data
      when there is no user, without calling `getProfile`
    - _Requirements: 7.1, 7.3, 7.4, 7.5, 7.6, 7.15, 7.16, 9.1, 9.2, 9.3, 9.4, 9.7_

- [ ] 16. [kiro] Implement `GET /api/county` with unit tests
  - [ ] 16.1 Implement `app/api/county/route.ts` and the exported `getCountyCard`
    - Export `CountyOutcome` and `getCountyCard(profiles, readCsv, userId)` (type-only
      import of `ProfileReader` from the timeline route): a thrown profile read, missing
      profile, or `null`/`''` county → `{ available: false }`; a throwing `readCsv` or a
      `null` parse → `{ available: false }`; else `findCountyCard` →
      `{ available: true, card }` or `{ available: false }`;
      `CountyResponseSchema.safeParse` failure → 500 `{ error: 'county_unavailable' }`
      without the unvalidated values
    - Production `readCsv` uses `readFileSync(/*turbopackIgnore: true*/ join(process.cwd(),
      'data', 'public', 'cdc-places-short-sleep-ma-2022.csv'), 'utf-8')` in the route
      module, following `lib/inbox.ts`; thin `GET` handler returns 401 with no card values
      when there is no user
    - Add `"/api/county": ["./data/public/cdc-places-short-sleep-ma-2022.csv"]` to
      `outputFileTracingIncludes` in `next.config.ts`, keeping the existing entry
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.12, 8.13_
  - [ ] 16.2 Write unit tests in `tests/unit/county-route.test.ts`
    - Maya (`Hampshire`) → `{ available: true, card: { county: 'Hampshire', year: 2022,
      prevalence: 31.5, low: 26.8, high: 36.4 } }` with no `population` key, read from the
      real CSV; `hampshire`, `null`, `''`, a missing profile and an unknown county →
      `{ available: false }`; a throwing reader and a row with `low > prevalence` →
      `{ available: false }`; a payload forced past the lookup that fails the schema →
      500 `county_unavailable`; a mocked server client with no user → 401
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.12, 8.13_

- [ ] 17. [kiro] Boundary/smoke tests
  - [ ] 17.1 Extend `tests/unit/boundary-smoke.test.ts`
    - Assert `SUPABASE_SERVICE_ROLE_KEY` still appears only in
      `app/api/demo/start/route.ts`; the pure modules `lib/fillers.ts`,
      `lib/speech-features.ts`, `lib/baseline.ts`, `lib/signal.ts`, `lib/weekly.ts`,
      `lib/timeline.ts` and `lib/county.ts` import no `node:fs`, `@supabase/*`,
      `@anthropic-ai/*` or `next/*`; `lib/api-schemas.ts` still imports only `zod`;
      `FeatureNameSchema.options` equals `FEATURES`
    - Assert no file `lib/rtk-gate.ts` exists and no source file imports `'/rtk-gate'`, so
      `gate` is reachable only from `lib/signal.ts` (Req 5.1, D6)
    - _Requirements: 1.1, 2.8, 2.9, 3.1, 4.2, 5.1, 6.10_

- [ ] 18. Final checkpoint - Ensure all tests pass
  - Run `npm run lint`, `npm run test:unit` and `npm run test:pbt`; ensure all pass, ask
    the user if questions arise.

## Notes

- Every task is tagged `[kiro]` and covers logic, database, scripts, schemas, routes, and
  tests. The Timeline_Screen (including its health layer turn-on control) and
  Context_Card UI are built separately by Claude Code and are deliberately excluded;
  criteria 7.7–7.14, 8.6–8.11 and 9.5–9.6 (and the rendering side of 5.6–5.8) stay their
  acceptance contract. Requirement 5.9 is honoured because this spec adds no user-facing
  copy or model prompt beyond fixed error codes.
- Every property test (P1–P18) is required and none is marked optional. P1–P6 carry the
  requirement IDs; P7–P16 and P18 come from the design; P17 extends twin-loop's P4 in
  `tests/pbt/delete-vault.test.ts`. P6 and P10 sit under task 3 because they call
  `detectSignal`; P18 sits under task 15 because it calls `getTimeline`.
- The opt-in check (Requirement 9, D11) lives only in `getTimeline` (15.1): auth in the
  handler → profile read → opt-in check → weekly read. P18 and the 15.3 unit tests use
  `countingWeeklyRepo` (2.3) to prove no weekly row is read for an opted-out caller.
- Each property test is a single `it(...)` with the
  `// Feature: health-baseline, Property {n}: …` tag comment and a `Validates:` line, run
  with at least 100 fast-check iterations. Properties that share a file (P4/P8, P2/P3/P7,
  P15/P16) are scheduled in separate waves.
- Each task references the specific requirements (and any property) it satisfies.
- Checkpoints validate incrementally at each natural break.
- The calibration test (12.3) is the single guard that Maya's first signal falls in
  `[39, 40)`; the generator does not import `lib/`.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "4.1", "5.1", "7.1", "9", "12.1"] },
    { "id": 1, "tasks": ["1.2", "2.2", "4.2", "5.2", "7.2", "8.1", "12.2"] },
    { "id": 2, "tasks": ["1.3", "1.5", "2.3", "3.1", "4.3", "5.3", "8.2", "12.4"] },
    { "id": 3, "tasks": ["1.4", "2.4", "2.5", "2.6", "3.2", "3.3", "3.6", "3.7", "3.8", "3.9", "8.3", "10.1", "12.3", "14.1"] },
    { "id": 4, "tasks": ["3.4", "3.10", "10.2", "13.1", "14.2", "14.3", "15.1"] },
    { "id": 5, "tasks": ["3.5", "13.2", "15.2", "15.3", "16.1"] },
    { "id": 6, "tasks": ["16.2", "17.1"] }
  ]
}
```
