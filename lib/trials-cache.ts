/**
 * The trial finder's server-side cache: one successful ClinicalTrials.gov
 * result per family condition, served for `TRIALS_CACHE_TTL_MS`. (Req 5.4, 5.5)
 *
 * Production keeps one module-level `InMemoryTrialsCache` in
 * `app/api/trials/route.ts`. On Vercel it lives per warm instance, so a cold
 * instance fetches again; tests inject a fresh instance. Freshness is decided
 * by the route against its injected clock, not here, so a stale entry can still
 * be served when the live API fails (Req 5.6).
 */

import type { FamilyCondition, Trial } from './trials';

/** How long a cached live result is served without a new request: 3600 s. (Req 5.4) */
export const TRIALS_CACHE_TTL_MS = 3_600_000;

/** A cached live result and when it was stored (ms since epoch). */
export type TrialsCacheEntry = { trials: Trial[]; storedAt: number };

export interface TrialsCache {
  get(condition: FamilyCondition): TrialsCacheEntry | undefined;
  set(condition: FamilyCondition, entry: TrialsCacheEntry): void;
}

/** Deep-enough copy so callers never share arrays with the cache. */
function copyEntry(entry: TrialsCacheEntry): TrialsCacheEntry {
  return {
    storedAt: entry.storedAt,
    trials: entry.trials.map((t) => ({ ...t, conditions: [...t.conditions], cities: [...t.cities] })),
  };
}

/** A `Map` keyed by condition that stores and returns copies. */
export class InMemoryTrialsCache implements TrialsCache {
  private readonly entries = new Map<FamilyCondition, TrialsCacheEntry>();

  get(condition: FamilyCondition): TrialsCacheEntry | undefined {
    const entry = this.entries.get(condition);
    return entry ? copyEntry(entry) : undefined;
  }

  set(condition: FamilyCondition, entry: TrialsCacheEntry): void {
    this.entries.set(condition, copyEntry(entry));
  }
}
