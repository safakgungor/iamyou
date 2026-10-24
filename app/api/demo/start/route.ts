/**
 * `POST /api/demo/start` — seed the "Try as Maya" synthetic demo. (Req 1)
 *
 * Pre-condition: the browser has already called
 * `supabase.auth.signInAnonymously()` with the **publishable** key and holds an
 * anonymous session (Req 1.1). This route never signs anyone in.
 *
 * Flow:
 *  1. Read the caller via the request-scoped **server** client (`auth.getUser()`).
 *     No user → 401 (Req 1.*, auth gate).
 *  2. Only then create a **service-role** client (reads
 *     `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`) and upsert Maya's
 *     `profile.json`, all 40 `vault-entries.json` rows and all
 *     `weekly-features.json` rows (`synthetic = true`) for the caller's own
 *     `user_id`. The service-role key is read ONLY here, in server code, and is
 *     never exposed to the client (Req 1.3, 1.4; health-baseline Req 2.7–2.9).
 *  3. Upserts are idempotent — profile by `user_id`, vault entries by the
 *     composite `(user_id, id)`, weekly features by `(user_id, week_start)` —
 *     so a repeated POST produces no duplicate rows (Req 1.2; health-baseline
 *     Req 2.10).
 *  4. On any seeding error, respond 500 `{ error }`. The client treats a non-200
 *     as "demo unavailable" and never presents a partial session (Req 1.6).
 *     Postgres has no cross-statement transaction over the REST client here, so
 *     "nothing partial" is achieved by idempotent, re-runnable upserts: a failed
 *     seed can be fully healed by retrying `POST /api/demo/start`, and the client
 *     only ever renders the demo after a 200 (Req 1.7).
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/db/supabase-server';
import {
  SupabaseVaultRepository,
  type Profile,
  type VaultEntry,
  type VaultEntryKind,
  type VaultRepository,
} from '@/lib/db/vault-repository';
import {
  SupabaseWeeklyFeatureRepository,
  type WeeklyFeatureRepository,
} from '@/lib/db/weekly-feature-repository';
import type { WeeklyFeatureRow } from '@/lib/baseline';
import mayaProfile from '@/data/synthetic/maya/profile.json';
import mayaVaultEntries from '@/data/synthetic/maya/vault-entries.json';
import mayaWeeklyFeatures from '@/data/synthetic/maya/weekly-features.json';

/** Reads a required environment variable, throwing a clear error when missing. */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Builds Maya's `Profile` from `profile.json`, forcing the demo invariants the
 * seed guarantees regardless of the file: `rtkSetting = 'tell_me'`,
 * `healthLayerOptIn = true`, `synthetic = true` (Req 1.2).
 */
export function mayaDemoProfile(): Profile {
  return {
    firstName: mayaProfile.first_name,
    lastName: mayaProfile.last_name,
    dateOfBirth: mayaProfile.date_of_birth,
    county: mayaProfile.county,
    familyHistory: mayaProfile.family_history as Profile['familyHistory'],
    healthLayerOptIn: true,
    rtkSetting: 'tell_me',
    digitalWill: mayaProfile.digital_will,
    synthetic: true,
  };
}

/**
 * Builds Maya's 40 vault entries (`v001`–`v040`) from `vault-entries.json`,
 * preserving each id so the seed is idempotent on `(user_id, id)` (Req 1.2).
 */
export function mayaDemoVaultEntries(): VaultEntry[] {
  return (mayaVaultEntries as Array<{
    id: string;
    kind: string;
    text: string;
    created_at: string;
  }>).map((e) => ({
    id: e.id,
    kind: e.kind as VaultEntryKind,
    text: e.text,
    createdAt: e.created_at,
  }));
}

/**
 * Builds Maya's weekly feature rows (1,149 weeks) from `weekly-features.json`,
 * mapping `week_start` → `weekStart` and forcing `synthetic = true` regardless
 * of the file (health-baseline Req 2.7).
 */
export function mayaDemoWeeklyFeatures(): WeeklyFeatureRow[] {
  return (mayaWeeklyFeatures as Array<{
    week_start: string;
    vocabulary_diversity: number | null;
    mean_sentence_length: number | null;
    filler_rate: number | null;
    sleep_hours: number | null;
    active_minutes: number | null;
    twin_accuracy: number | null;
  }>).map((r) => ({
    weekStart: r.week_start,
    vocabulary_diversity: r.vocabulary_diversity,
    mean_sentence_length: r.mean_sentence_length,
    filler_rate: r.filler_rate,
    sleep_hours: r.sleep_hours,
    active_minutes: r.active_minutes,
    twin_accuracy: r.twin_accuracy,
    synthetic: true,
  }));
}

/**
 * Seeds the demo for `userId`: one profile upsert, one upsert per vault entry,
 * then one weekly-features upsert of `weeklyRows`, all owned by the caller
 * (health-baseline Req 2.7). Pure of HTTP and auth so a unit test can call it
 * with `InMemoryVaultRepository` and `InMemoryWeeklyFeatureRepository`. Every
 * upsert is idempotent (vault on `(user_id, id)`, weekly on
 * `(user_id, week_start)`), so a repeated call creates no duplicates
 * (Req 1.2, 2.10). Throws on the first repository error; the route maps that
 * to a 500.
 *
 * Signature:
 * `seedDemo(repo, weeklyRepo, userId, profile, entries, weeklyRows): Promise<void>`.
 */
export async function seedDemo(
  repo: VaultRepository,
  weeklyRepo: WeeklyFeatureRepository,
  userId: string,
  profile: Profile,
  entries: VaultEntry[],
  weeklyRows: readonly WeeklyFeatureRow[]
): Promise<void> {
  await repo.upsertProfile(userId, profile);
  for (const entry of entries) {
    await repo.upsertVaultEntry(userId, entry);
  }
  await weeklyRepo.upsertWeeklyFeatures(userId, weeklyRows);
}

export async function POST(): Promise<NextResponse> {
  // 1. Authenticate the caller on the request-scoped server client.
  let userId: string;
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    userId = user.id;
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2. Seed with the service-role client. Any failure → 500, nothing partial
  //    presented to the client (idempotent upserts heal a retried seed).
  try {
    const serviceClient = createClient(
      requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
      requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    const repo = new SupabaseVaultRepository(serviceClient);
    const weeklyRepo = new SupabaseWeeklyFeatureRepository(serviceClient);

    await seedDemo(
      repo,
      weeklyRepo,
      userId,
      mayaDemoProfile(),
      mayaDemoVaultEntries(),
      mayaDemoWeeklyFeatures()
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to start demo';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
