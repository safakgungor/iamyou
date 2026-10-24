/**
 * `GET /api/trials` — recruiting studies with a Massachusetts site for the
 * caller's family condition. (Req 5, 6)
 *
 * Every HTTP fetch, the cache and the CSV read happen here, in server code;
 * the client never calls ClinicalTrials.gov (Req 5.8). The handler is thin: it
 * resolves the caller, wires the production collaborators and delegates to
 * `getTrials`, which takes them as arguments so unit tests run it with an
 * in-memory repository, cache, fake fetch and clock.
 *
 * Flow (design "GET /api/trials"):
 *   1. Load the profile (404 without one). A family history that is not one of
 *      the three family conditions → `no_family_condition`, no request (Req 5.2, 5.3).
 *   2. A cache entry younger than 3600 s → serve it as `cache`, no request (Req 5.5).
 *   3. Otherwise request the API with a 10 s abort + race (Req 5.1, 5.6). On
 *      success: normalize, filter, cache, serve `live` or `no_matches` (Req 5.4, 5.7).
 *   4. On error or timeout: a stale cache entry as `stale_cache` (Req 5.6), else
 *      the saved slice, keyword-matched and filtered, as `saved_ma_slice` or
 *      `no_matches` (Req 6.1–6.5). An unreadable slice → 503.
 *
 * Requirements: 5.1–5.8, 6.1–6.5.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { NextResponse } from 'next/server';

import { TrialsResponseSchema, type TrialsResponse } from '@/lib/api-schemas';
import { SupabaseVaultRepository, type VaultRepository } from '@/lib/db/vault-repository';
import { createSupabaseServerClient } from '@/lib/db/supabase-server';
import {
  CONDITION_QUERY,
  MASSACHUSETTS,
  NO_MATCH_TEXT,
  RECRUITING,
  conditionSearchUrl,
  filterTrials,
  isFamilyCondition,
  matchesCondition,
  normalizeTrial,
  parseSliceCsv,
  type FamilyCondition,
  type Trial,
} from '@/lib/trials';
import { InMemoryTrialsCache, TRIALS_CACHE_TTL_MS, type TrialsCache } from '@/lib/trials-cache';

/** The ClinicalTrials.gov API v2 studies endpoint. Server code only. (Req 5.1, 5.8) */
export const TRIALS_API_URL = 'https://clinicaltrials.gov/api/v2/studies';

/** The study fields the trial finder reads. (Req 5.1) */
export const TRIALS_API_FIELDS = [
  'NCTId',
  'BriefTitle',
  'OverallStatus',
  'Condition',
  'Phase',
  'LocationCity',
  'LocationState',
] as const;

/** Give up on the live API after 10 seconds. (Req 5.6, 6.1) */
export const TRIALS_API_TIMEOUT_MS = 10_000;

/** The saved Massachusetts slice, the offline fallback. (Req 6.1) */
const SLICE_PATH = join(
  process.cwd(),
  'data',
  'public',
  'clinicaltrials-ma-recruiting-2026-10-18.csv',
);

/** The collaborators `getTrials` needs; tests inject fakes. */
export type TrialsDeps = {
  vault: Pick<VaultRepository, 'getProfile'>;
  cache: TrialsCache;
  fetchLiveStudies: (condition: FamilyCondition, signal: AbortSignal) => Promise<unknown>;
  readSlice: () => Promise<string>;
  now: () => number;
  timeoutMs?: number;
};

export type TrialsOutcome =
  | { status: 200; body: TrialsResponse }
  | { status: 404; body: { error: string } }
  | { status: 503; body: { error: 'trials_unavailable' } };

/**
 * Requests recruiting studies for `condition` with a Massachusetts location
 * from the ClinicalTrials.gov API v2, and throws on a non-2xx status. (Req 5.1)
 */
export async function fetchLiveStudies(
  condition: FamilyCondition,
  signal: AbortSignal,
): Promise<unknown> {
  const url = new URL(TRIALS_API_URL);
  url.searchParams.set('query.cond', CONDITION_QUERY[condition]);
  url.searchParams.set('query.locn', MASSACHUSETTS);
  url.searchParams.set('filter.overallStatus', RECRUITING);
  url.searchParams.set('fields', TRIALS_API_FIELDS.join(','));
  url.searchParams.set('pageSize', '100');

  const response = await fetch(url, { signal, headers: { accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`ClinicalTrials.gov responded ${response.status}`);
  }
  return response.json();
}

/** Reads the saved slice. The path is fixed; next.config.ts ships the file with this route. */
export function readSavedSlice(): Promise<string> {
  return readFile(/*turbopackIgnore: true*/ SLICE_PATH, 'utf8');
}

/** The `studies` array of a live response, or `null` for any other shape. */
function studiesOf(body: unknown): unknown[] | null {
  if (typeof body !== 'object' || body === null) return null;
  const studies = (body as { studies?: unknown }).studies;
  return Array.isArray(studies) ? studies : null;
}

/**
 * Runs `fetchLiveStudies` with an abort after `timeoutMs`, raced against the
 * same timeout so a fetch that ignores the signal still times out. Resolves
 * with the studies, or `null` on error, timeout or a bad shape. (Req 5.6)
 */
async function fetchWithTimeout(
  deps: TrialsDeps,
  condition: FamilyCondition,
): Promise<unknown[] | null> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('timeout'));
    }, deps.timeoutMs ?? TRIALS_API_TIMEOUT_MS);
  });

  try {
    const body = await Promise.race([deps.fetchLiveStudies(condition, controller.signal), timeout]);
    return studiesOf(body);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** One response for a served list: `ok` when it has trials, else the shared empty state. */
function served(
  trials: Trial[],
  origin: 'live' | 'cache' | 'stale_cache' | 'saved_ma_slice',
  condition: FamilyCondition,
): TrialsOutcome {
  const search_url = conditionSearchUrl(condition);
  if (trials.length === 0) {
    return { status: 200, body: { status: 'no_matches', trials: [], message: NO_MATCH_TEXT, search_url } };
  }
  return { status: 200, body: { status: 'ok', origin, trials, search_url } };
}

/** The testable core of the trials route. (Req 5, 6) */
export async function getTrials(deps: TrialsDeps, userId: string): Promise<TrialsOutcome> {
  const profile = await deps.vault.getProfile(userId);
  if (!profile) {
    return { status: 404, body: { error: 'Profile not found' } };
  }

  // 1. No family condition: no API request at all. (Req 5.2, 5.3)
  const condition: unknown = profile.familyHistory;
  if (!isFamilyCondition(condition)) {
    return { status: 200, body: { status: 'no_family_condition', trials: [] } };
  }

  // 2. A fresh cache entry is served without a request. (Req 5.5)
  const cached = deps.cache.get(condition);
  if (cached && deps.now() - cached.storedAt < TRIALS_CACHE_TTL_MS) {
    return served(cached.trials, 'cache', condition);
  }

  // 3. The live API, cached on success. (Req 5.1, 5.4, 5.7)
  const studies = await fetchWithTimeout(deps, condition);
  if (studies !== null) {
    const trials = filterTrials(studies.map((s) => normalizeTrial(s, 'live')));
    deps.cache.set(condition, { trials, storedAt: deps.now() });
    return served(trials, 'live', condition);
  }

  // 4. Error or timeout: any cached entry, even a stale one. (Req 5.6)
  if (cached) {
    return served(cached.trials, 'stale_cache', condition);
  }

  // 5. Otherwise the saved slice; non-matching rows are never substituted. (Req 6.1–6.5)
  let text: string;
  try {
    text = await deps.readSlice();
  } catch {
    return { status: 503, body: { error: 'trials_unavailable' } };
  }
  const trials = filterTrials(
    parseSliceCsv(text)
      .map((row) => normalizeTrial(row, 'saved_ma_slice'))
      .filter((trial) => matchesCondition(trial, condition)),
  );
  return served(trials, 'saved_ma_slice', condition);
}

/** One cache per warm server instance. */
const cache = new InMemoryTrialsCache();

/** Thin HTTP handler: resolves the caller, wires production collaborators, delegates. */
export async function GET(): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const outcome = await getTrials(
    {
      vault: new SupabaseVaultRepository(supabase),
      cache,
      fetchLiveStudies,
      readSlice: readSavedSlice,
      now: Date.now,
    },
    user.id,
  );

  if (outcome.status !== 200) {
    return NextResponse.json(outcome.body, { status: outcome.status });
  }
  return NextResponse.json(TrialsResponseSchema.parse(outcome.body));
}
