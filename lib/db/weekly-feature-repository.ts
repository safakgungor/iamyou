/**
 * The `WeeklyFeatureRepository` data-access interface over the `weekly_features`
 * table and its in-memory implementation.
 *
 * Routes depend on the `WeeklyFeatureRepository` interface; tests inject
 * `InMemoryWeeklyFeatureRepository`; production uses
 * `SupabaseWeeklyFeatureRepository` (below). The in-memory
 * implementation is the one exercised by the timeline, demo-seed and vault
 * route unit tests and the "deleting a vault also deletes weekly features"
 * property P17.
 *
 * Field names use camelCase at the TypeScript boundary (`weekStart`); the SQL
 * columns (snake_case, e.g. `week_start`) are mapped by the Supabase
 * implementation.
 */

import { FEATURES, type WeeklyFeatureRow } from '../baseline';

export interface WeeklyFeatureRepository {
  /** Every row owned by userId, ascending weekStart. (Req 2.4, 7.1) */
  listWeeklyFeatures(userId: string): Promise<WeeklyFeatureRow[]>;

  /**
   * Insert-or-replace on (user_id, week_start); idempotent, so a repeated demo
   * seed cannot duplicate rows. (Req 2.3, 2.10)
   */
  upsertWeeklyFeatures(
    userId: string,
    rows: readonly WeeklyFeatureRow[]
  ): Promise<void>;

  /** Removes every row owned by userId; other users untouched. (Req 2.11) */
  deleteForUser(userId: string): Promise<void>;
}

/** Ascending `weekStart` order; ISO dates sort correctly as strings. */
function byWeekStart(a: WeeklyFeatureRow, b: WeeklyFeatureRow): number {
  if (a.weekStart < b.weekStart) return -1;
  if (a.weekStart > b.weekStart) return 1;
  return 0;
}

/**
 * In-memory `WeeklyFeatureRepository` backed by
 * `Map<userId, Map<weekStart, WeeklyFeatureRow>>`.
 *
 * Keying the inner map by `weekStart` mirrors the (user_id, week_start)
 * uniqueness constraint, so an upsert replaces rather than duplicates
 * (Req 2.3, 2.10). Rows are copied on the way in and on the way out so callers
 * cannot mutate stored rows by reference. `deleteForUser(userId)` drops that
 * user's inner map while leaving every other user's rows untouched (Req 2.11).
 */
export class InMemoryWeeklyFeatureRepository implements WeeklyFeatureRepository {
  private readonly rows = new Map<string, Map<string, WeeklyFeatureRow>>();

  async listWeeklyFeatures(userId: string): Promise<WeeklyFeatureRow[]> {
    const bucket = this.rows.get(userId);
    if (!bucket) return [];
    return [...bucket.values()].map((r) => ({ ...r })).sort(byWeekStart);
  }

  async upsertWeeklyFeatures(
    userId: string,
    rows: readonly WeeklyFeatureRow[]
  ): Promise<void> {
    const bucket = this.rows.get(userId) ?? new Map<string, WeeklyFeatureRow>();
    for (const row of rows) {
      bucket.set(row.weekStart, { ...row });
    }
    this.rows.set(userId, bucket);
  }

  /**
   * Removes every row owned by `userId`, leaving other users' maps untouched.
   * (Req 2.11 / P17)
   */
  async deleteForUser(userId: string): Promise<void> {
    this.rows.delete(userId);
  }
}

// ---------------------------------------------------------------------------
// Supabase implementation
// ---------------------------------------------------------------------------

import type { SupabaseClient } from '@supabase/supabase-js';

/** Rows per upsert request: 1,149 Maya rows → 3 requests. */
const UPSERT_CHUNK_SIZE = 500;

/** Rows per select page, matching the PostgREST default row cap. */
const LIST_PAGE_SIZE = 1000;

/**
 * Shape of a `weekly_features` row as stored in Postgres (snake_case columns).
 * The six feature columns are `numeric`, which PostgREST may return as either
 * a number or a numeric string, so they are typed loosely here and normalised
 * by `toNullableNumber`.
 */
type WeeklyFeatureDbRow = {
  user_id: string;
  week_start: string;
  vocabulary_diversity: unknown;
  mean_sentence_length: unknown;
  filler_rate: unknown;
  sleep_hours: unknown;
  active_minutes: unknown;
  twin_accuracy: unknown;
  synthetic: boolean;
};

/**
 * Maps a `numeric` column value to `number | null`: a finite number is
 * returned as-is, a numeric string (e.g. `"0.62"`) is parsed, and anything
 * else (null, undefined, empty or non-numeric strings, NaN, Infinity, other
 * types) becomes `null`, so a missing measurement is never read as 0.
 */
export function toNullableNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toWeeklyFeatureRow(row: WeeklyFeatureDbRow): WeeklyFeatureRow {
  const out = {
    weekStart: row.week_start,
    synthetic: row.synthetic === true,
  } as WeeklyFeatureRow;
  for (const feature of FEATURES) {
    out[feature] = toNullableNumber(row[feature]);
  }
  return out;
}

function toDbRow(userId: string, row: WeeklyFeatureRow): WeeklyFeatureDbRow {
  return {
    user_id: userId,
    week_start: row.weekStart,
    vocabulary_diversity: row.vocabulary_diversity,
    mean_sentence_length: row.mean_sentence_length,
    filler_rate: row.filler_rate,
    sleep_hours: row.sleep_hours,
    active_minutes: row.active_minutes,
    twin_accuracy: row.twin_accuracy,
    synthetic: row.synthetic,
  };
}

/**
 * Production `WeeklyFeatureRepository` backed by Supabase/Postgres.
 *
 * It runs on an injected `SupabaseClient`: the request-scoped `@supabase/ssr`
 * server client in `/api/timeline` and `/api/vault`, so every statement
 * executes under the caller's `auth.uid()` and row-level security enforces
 * per-user isolation (Req 2.4, 2.5); the service-role client only in
 * `/api/demo/start`. Every statement additionally filters by
 * `user_id = userId` (writes carry `user_id = userId` on every row).
 *
 * The TypeScript boundary is camelCase (`weekStart`); the SQL column is
 * snake_case (`week_start`), mapped by `toWeeklyFeatureRow` and `toDbRow`.
 * The six feature keys are already snake_case on both sides.
 */
export class SupabaseWeeklyFeatureRepository implements WeeklyFeatureRepository {
  constructor(private readonly client: SupabaseClient) {}

  /**
   * Every row owned by `userId`, ascending `week_start`, read in `.range()`
   * pages of 1,000 so the PostgREST default row cap never truncates a
   * history. (Req 2.4, 7.1)
   */
  async listWeeklyFeatures(userId: string): Promise<WeeklyFeatureRow[]> {
    const out: WeeklyFeatureRow[] = [];
    for (let from = 0; ; from += LIST_PAGE_SIZE) {
      const { data, error } = await this.client
        .from('weekly_features')
        .select('*')
        .eq('user_id', userId)
        .order('week_start', { ascending: true })
        .range(from, from + LIST_PAGE_SIZE - 1);
      if (error) throw error;
      const page = (data ?? []) as WeeklyFeatureDbRow[];
      for (const row of page) out.push(toWeeklyFeatureRow(row));
      if (page.length < LIST_PAGE_SIZE) break;
    }
    return out;
  }

  /**
   * Insert-or-replace on `(user_id, week_start)` in chunks of 500 rows, so a
   * repeated demo seed cannot duplicate rows. (Req 2.5, 2.10)
   */
  async upsertWeeklyFeatures(
    userId: string,
    rows: readonly WeeklyFeatureRow[]
  ): Promise<void> {
    for (let i = 0; i < rows.length; i += UPSERT_CHUNK_SIZE) {
      const chunk = rows
        .slice(i, i + UPSERT_CHUNK_SIZE)
        .map((row) => toDbRow(userId, row));
      const { error } = await this.client
        .from('weekly_features')
        .upsert(chunk, { onConflict: 'user_id,week_start' });
      if (error) throw error;
    }
  }

  /**
   * Removes every row owned by `userId` with a single delete filtered by
   * `user_id`, leaving other users' rows untouched. (Req 2.11 / P17)
   */
  async deleteForUser(userId: string): Promise<void> {
    const { error } = await this.client
      .from('weekly_features')
      .delete()
      .eq('user_id', userId);
    if (error) throw error;
  }
}
