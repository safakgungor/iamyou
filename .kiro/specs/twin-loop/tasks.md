# Implementation Plan: twin-loop

## Overview

This plan implements the twin-loop predict-and-correct core as a Next.js (App Router,
TypeScript strict) PWA with Supabase persistence and server-only Claude calls. Work
proceeds bottom-up: scaffold first, then the pure `lib` modules with their property
tests, then the vault repository, the SQL migration, the server-only Claude layer, and
finally the API routes with unit tests. User-facing pages, the voice hook, styling and
the PWA manifest/icons come last and are optional.

Task titles are tagged `[kiro]` (logic, data, Claude layer, routes, tests) or
`[claude-code]` (pages, voice hook, styling, PWA assets). Every `[claude-code]` sub-task
is marked optional with `*`. Property tests P1–P5 are required.

## Tasks

- [x] 1. [kiro] Scaffold the Next.js + TypeScript + Tailwind project (no create-next-app)
  - Write `package.json` with scripts `dev`, `build`, `lint` (`tsc --noEmit`),
    `test:unit` (`vitest run tests/unit`), `test:pbt` (`vitest run tests/pbt`);
    dependencies `next`, `react`, `react-dom`, `@anthropic-ai/sdk`, `@supabase/ssr`,
    `@supabase/supabase-js`, `zod`; devDependencies `typescript`, `@types/node`,
    `@types/react`, `@types/react-dom`, `vitest`, `fast-check`, `tailwindcss`,
    `@tailwindcss/postcss`
  - Write `tsconfig.json` with `strict: true` and the Next.js plugin
  - Write `next.config.ts`
  - Write the Tailwind CSS v4 setup: `postcss.config.mjs` with the `@tailwindcss/postcss`
    plugin and `app/globals.css` starting with `@import "tailwindcss";` (no
    `tailwind.config.ts`, no autoprefixer)
  - Write `vitest.config.ts` configured for the `tests/unit` and `tests/pbt` paths
  - Write a minimal `app/layout.tsx` that imports `globals.css`
  - DO NOT run create-next-app; DO NOT overwrite or modify AGENTS.md, CLAUDE.md,
    README.md, KIRO_LOG.md, .gitignore, .env.example, docs/, data/, or .kiro/
  - _Requirements: tech stack (tech.md), structure.md_

- [x] 2. [kiro] Implement scoring pure module `lib/score.ts`
  - [x] 2.1 Implement `clampScore` and `weeklyTrend`
    - `clampScore(x)` = `Number.isNaN(x) ? 0 : Math.min(1, Math.max(0, x))`
    - `weeklyTrend` groups answers by ISO-8601 week of `createdAt`, averages the
      already-clamped scores, returns one entry per distinct week keyed `YYYY-Www`
    - _Requirements: 6.2, 6.3, 8.2, 8.3_
  - [x] 2.2 Write property test P1 for `clampScore` (tests/pbt)
    - **Property 1: Score clamping** — for all numbers `x`, `clampScore(x)` is within
      [0, 1], and `clampScore(NaN)` is 0; include `±Infinity`, large/negative inputs
    - **Validates: Requirements 6.2, 6.3**
  - [x] 2.3 Write property test P3 for `weeklyTrend` (tests/pbt)
    - **Property 3: Weekly trend shape and bounds** — one value per ISO week present, no
      key for absent weeks, every value within [0, 1]
    - **Validates: Requirements 8.2, 8.3**

- [x] 3. [kiro] Implement prediction pure module `lib/prediction.ts`
  - [x] 3.1 Implement `selectPredictionContext` and `buildPredictionRequest`
    - Define `VaultEntry` and `PredictionRequest` types
    - `selectPredictionContext` keeps every `correction`, excludes every `style_example`,
      and appends the 30 most recent `story | opinion | conversation` entries by
      `createdAt` descending
    - `buildPredictionRequest(prompt, context)` takes NO answer parameter
    - _Requirements: 4.3, 4.4, 7.4_
  - [x] 3.2 Write property test P2 for `buildPredictionRequest` (tests/pbt)
    - **Property 2: Prediction never sees the answer** — for any vault and any answer
      string absent from it, the serialized request never contains that answer string
    - **Validates: Requirements 4.3, 4.4**
  - [x] 3.3 Write the context-selection supporting property test (tests/pbt)
    - **Supporting property: Context selection** — every `correction` appears in the
      output and no `style_example` does, over arbitrary entry sets of all five kinds
    - **Validates: Requirements 7.4**

- [x] 4. [kiro] Implement safety copy module `lib/safety.ts`
  - Export the exact `SUPPORT_MESSAGE` (988 Suicide & Crisis Lifeline, 911) and
    `COUNSELOR_MESSAGE` (genetic counselor, never interprets a result) strings from the
    design verbatim
  - _Requirements: 9.1, 9.3, 2.6, 6.7_

- [x] 5. [kiro] Implement check-in pure module `lib/check-in.ts`
  - [x] 5.1 Implement `buildCheckInResult` and `sessionScore`
    - Define `Grade` and `CheckInResult` types
    - `buildCheckInResult` checks `crisis` FIRST and returns
      `{ kind: 'support', message: SUPPORT_MESSAGE }` with no score/prediction/reply;
      else if `genetics_question` returns a `scored` result with reply replaced by
      `COUNSELOR_MESSAGE`; else returns the normal `scored` result
    - `sessionScore` = mean of this session's clamped scores (0 if none)
    - _Requirements: 6.5, 8.1, 9.1, 9.3_
  - [x] 5.2 Write property test P5 for `buildCheckInResult` (tests/pbt)
    - **Property 5: Crisis and genetics result shaping** — crisis=true ⇒ support result
      with no score/prediction/reply regardless of genetics_question; crisis=false &
      genetics_question=true ⇒ scored result keeping score + prediction with reply
      replaced by `COUNSELOR_MESSAGE`
    - **Validates: Requirements 6.5, 9.1, 9.3**

- [x] 6. Checkpoint - Ensure all pure-module tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. [kiro] Implement the vault repository `lib/db/vault-repository.ts`
  - [x] 7.1 Define the `VaultRepository` interface and `InMemoryVaultRepository`
    - Interface methods: profile get/upsert; vault-entry list/add/upsert; prediction
      create/get; answer create/list/listSession; `deleteVault`
    - `InMemoryVaultRepository` backed by per-`userId` maps; `deleteVault` drops the
      user's buckets in all four maps while leaving other users untouched
    - _Requirements: 3.1, 3.2, 3.5, 3.6_
  - [x] 7.2 Write property test P4 for `deleteVault` on the in-memory repo (tests/pbt)
    - **Property 4: Delete leaves nothing** — after `deleteVault(userId)` the in-memory
      repo holds zero rows for `userId` across all four tables; other users' rows unchanged
    - **Validates: Requirements 3.5, 3.6**
  - [x] 7.3 Implement `SupabaseVaultRepository`
    - Uses the request-scoped `@supabase/ssr` server client so every statement runs under
      the caller's `auth.uid()`; `deleteVault` issues one delete per table
    - _Requirements: 3.3, 3.4, 3.5_

- [x] 8. [kiro] Write the SQL migration `supabase/migrations/0001_twin_loop.sql`
  - Create `profiles`, `vault_entries`, `predictions`, `answers`, each with `user_id`;
    CHECK constraints on `family_history`, `rtk_setting`, `vault_entries.kind`, and
    `answers.score between 0 and 1`; composite PK `(user_id, id)` on `vault_entries`
  - Enable RLS on all four tables with select/insert/update/delete policies keyed on
    `user_id = auth.uid()`
  - _Requirements: 2.1, 2.2, 2.4, 3.1, 3.2, 3.3, 3.4_

- [x] 9. Checkpoint - Ensure repository and migration tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. [kiro] Implement the server-only Claude layer `lib/claude/`
  - [x] 10.1 Implement `lib/claude/schemas.ts`
    - zod request/response schemas for prediction, grading
      (`{score, rationale, crisis, genetics_question}`), spoken reply, and screening
      (`{crisis, genetics_question}`), plus every route request/response body
    - _Requirements: 6.1, 7.1, 7.2_
  - [x] 10.2 Implement `lib/claude/prompts.ts`
    - Every prompt string; prediction context never includes `style_example`; no prompt
      states or implies a medical condition
    - _Requirements: 4.3, 6.7, 7.4_
  - [x] 10.3 Implement the client functions in `lib/claude/index.ts`
    - `predictAnswer` (medium), `gradeAnswer` (medium), `spokenReply`
      (`beta.messages.create`, betas `["server-side-fallback-2026-07-01"]`,
      `fallbacks: "default"`, low), `screenText` (low); model `"claude-opus-5-5"`;
      no temperature/top_p/top_k; no assistant prefill
    - Check `stop_reason === 'refusal'` before reading content on every call
    - `gradeAnswer` refusal FAILS SAFE as `crisis: true`; `screenText` refusal ⇒ store
      nothing; reply refusal ⇒ fixed gentle non-diagnostic sentence
    - _Requirements: 4.6, 6.1, 6.6, 6.7, 9.1, 9.2_
  - [x] 10.4 Write unit tests for the Claude layer with a mocked client
    - Assert refusal branches: `gradeAnswer` refusal yields the crisis fail-safe,
      `screenText` refusal yields store-nothing, reply refusal yields the gentle sentence
    - _Requirements: 6.1, 6.7, 9.1, 9.2_

- [x] 11. [kiro] Implement `POST /api/demo/start` with unit tests
  - [x] 11.1 Implement the route
    - Read caller via server client (`auth.getUser()`); 401 if none; then use the
      service-role client to upsert Maya's `profile.json` (`rtk_setting='tell_me'`,
      `health_layer_opt_in=true`, `synthetic=true`) and all 40 `vault-entries.json` rows
      (ids `v001`–`v040`) for that `user_id`; upserts are idempotent; any failure returns
      500 and seeds nothing partial
    - Service-role key used only in this server route, never exposed to the client
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6, 1.7_
  - [x] 11.2 Write unit tests (in-memory repo + mocked Claude)
    - After start: 1 profile (rtk `tell_me`, health-layer `true`) and 40 vault entries
      `v001`–`v040`; a second call is idempotent; a forced failure returns 500, nothing
      partial
    - _Requirements: 1.2, 1.6, 1.7_

- [x] 12. [kiro] Implement `GET /api/checkin/next` with unit tests
  - [x] 12.1 Implement the route
    - Load the 20 prompts, pick the lowest-numbered prompt unanswered in the session,
      build context via `selectPredictionContext` + `buildPredictionRequest`, call
      `predictAnswer`, store a `predictions` row; response is `{ prediction_id, prompt }`
      with NO `predicted_text`
    - _Requirements: 4.1, 4.2, 4.3, 4.5, 4.6_
  - [x] 12.2 Write the next-response non-leak supporting property test (tests/pbt)
    - **Supporting property: Next-response non-leak** — for any predicted text, the
      serialized next-response body never contains the predicted text
    - **Validates: Requirements 4.5**
  - [x] 12.3 Write unit tests (in-memory repo + mocked Claude)
    - A prediction row is created, no answer row yet, body omits `predicted_text`, lowest
      unanswered prompt chosen
    - _Requirements: 4.2, 4.5_

- [x] 13. [kiro] Implement `POST /api/checkin/answer` with unit tests
  - [x] 13.1 Implement the route
    - Load the stored prediction; `gradeAnswer`; if refusal, FAIL SAFE as `crisis: true`
      — store no answer and no score, respond `{ kind: 'support', message: SUPPORT_MESSAGE }`;
      otherwise `clampScore`, store the answer row (clamped score, rationale, crisis,
      session id), compute `spokenReply` (skipped on crisis), and respond with
      `buildCheckInResult(...)`
    - _Requirements: 6.1, 6.2, 6.4, 6.5, 6.6, 6.7, 9.1, 9.3_
  - [x] 13.2 Write unit tests (in-memory repo + mocked Claude)
    - Non-crisis non-genetics ⇒ scored result with clamped score stored + prediction +
      reply; genetics ⇒ reply replaced by `COUNSELOR_MESSAGE`; crisis ⇒ support result,
      no answer stored; grading refusal ⇒ support result, no answer and no score stored
    - _Requirements: 6.4, 6.5, 9.1, 9.3_

- [x] 14. [kiro] Implement `POST /api/checkin/correct` with unit tests
  - [x] 14.1 Implement the route
    - Reject text over 280 chars with 400 before any model call; at most one correction
      per check-in; `screenText`; crisis ⇒ support result, store nothing; genetics ⇒
      counselor result, store nothing; else store a `vault_entries` row `kind='correction'`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 9.2, 9.4_
  - [x] 14.2 Write unit tests (in-memory repo + mocked Claude)
    - Clean text stores a correction row; screen→crisis stores nothing + support;
      screen→genetics stores nothing + counselor; over-280 ⇒ 400
    - _Requirements: 7.1, 7.2, 7.3, 9.2, 9.4_

- [x] 15. [kiro] Implement `GET /api/scores` with unit tests
  - [x] 15.1 Implement the route
    - Return `{ session_score, weekly_trend }` via `sessionScore` (this session's clamped
      scores) and `weeklyTrend` (all of the caller's clamped answers)
    - _Requirements: 8.1, 8.2, 8.3_
  - [x] 15.2 Write unit tests (in-memory repo)
    - Returns the session score and weekly trend for the caller
    - _Requirements: 8.1_

- [x] 16. [kiro] Implement `DELETE /api/vault` with unit tests
  - [x] 16.1 Implement the route
    - 401 if no caller; else call `repository.deleteVault(auth.uid())`, return `{ ok: true }`
    - _Requirements: 3.5, 3.6_
  - [x] 16.2 Write unit tests (in-memory repo)
    - DELETE calls `deleteVault`; afterward the caller owns zero rows
    - _Requirements: 3.5, 3.6_

- [x] 17. Checkpoint - Ensure all route, property, and unit tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 18. [kiro] Boundary/smoke tests
  - [x] 18.1 Assert `checkin-prompts.json` has exactly 20 prompts; assert Claude imports
    and the service-role key appear only in server code
    - _Requirements: 1.3, 1.4, 4.1, 4.6, 6.6_

- [x] 19. [claude-code] User-facing pages, voice, styling, and PWA assets (optional)
  - [x] 19.1 Implement `app/page.tsx` — landing + "Try as Maya" with a visible
    "Synthetic data" label on synthetic persona/history
    - _Requirements: 1.1, 1.5_
  - [x] 19.2 Implement `app/onboarding/page.tsx` — consent & settings
    - Store `family_history`, default `health_layer_opt_in=false`, default
      `rtk_setting=record_only`, digital-will placeholder; copy never diagnoses and the
      strongest wording is "You might want to talk to your doctor about this."
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_
  - [x] 19.3 Implement `app/home/page.tsx` — the hub
    - _Requirements: 8.1_
  - [x] 19.4 Implement `app/check-in/page.tsx` — the loop UI
    - Shows prompt, collects answer, reveals prediction + score + reply or the support
      message; never shows the prediction before the user answers
    - _Requirements: 4.5, 5.1, 5.2, 5.3, 6.5, 8.1, 9.1, 9.3_
  - [x] 19.5 Implement `components/use-speech.ts` — Web Speech hook
    - Wraps `SpeechRecognition`/`webkitSpeechRecognition` and `speechSynthesis`; exposes
      `supported: false` so the UI renders a text-input fallback
    - _Requirements: 5.1, 5.2, 5.3_
  - [x] 19.6 Styling pass with Tailwind
    - _Requirements: structure.md_
  - [x] 19.7 Add the PWA web app manifest and icons under `public/`
    - _Requirements: tech.md (PWA)_

- [x] 20. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks tagged `[kiro]` cover logic, data, the Claude layer, routes, and tests; tasks
  tagged `[claude-code]` cover pages, the voice hook, styling, and PWA assets.
- Every `[claude-code]` sub-task is marked optional with `*` so "Run all Tasks" skips
  them. Property tests P1–P5 are required and are not marked optional.
- Unit tests on the safety paths are required: the Claude layer (10.4), demo start (11.2),
  answer (13.2) and correction (14.2). The remaining route and smoke tests (12.3, 15.2,
  16.2, 18.1) are optional.
- Each task references the requirements (and any property P1–P5) it satisfies.
- Checkpoints validate incrementally at each natural break.
- The grading-refusal fail-safe (crisis = true, no answer/score stored, SUPPORT_MESSAGE)
  is implemented in task 10.3 and the answer route (13.1) and asserted in 13.2.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1", "3.1", "4", "7.1", "8"] },
    { "id": 2, "tasks": ["2.2", "2.3", "3.2", "3.3", "7.2", "7.3", "10.1"] },
    { "id": 3, "tasks": ["5.1", "10.2"] },
    { "id": 4, "tasks": ["5.2", "10.3"] },
    { "id": 5, "tasks": ["10.4", "11.1", "12.1", "13.1", "14.1", "15.1", "16.1"] },
    { "id": 6, "tasks": ["11.2", "12.2", "12.3", "13.2", "14.2", "15.2", "16.2", "18.1"] },
    { "id": 7, "tasks": ["19.1", "19.2", "19.3", "19.4", "19.5", "19.6", "19.7"] }
  ]
}
```
