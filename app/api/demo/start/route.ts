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
 *     `profile.json` and all 40 `vault-entries.json` rows for the caller's own
 *     `user_id`. The service-role key is read ONLY here, in server code, and is
 *     never exposed to the client (Req 1.3, 1.4).
 *  3. Upserts are idempotent — profile by `user_id`, vault entries by the
 *     composite `(user_id, id)` — so a repeated POST produces no duplicate rows
 *     (Req 1.2).
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
import mayaProfile from '@/data/synthetic/maya/profile.json';
import mayaVaultEntries from '@/data/synthetic/maya/vault-entries.json';

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
 * Seeds the demo into any `VaultRepository` for `userId`: one profile upsert and
 * one upsert per vault entry. Pure of HTTP and auth so a unit test can call it
 * with `InMemoryVaultRepository` (task 11.2). Throws on the first repository
 * error; the route maps that to a 500.
 *
 * Signature: `seedDemo(repo, userId, profile, entries): Promise<void>`.
 */
export async function seedDemo(
  repo: VaultRepository,
  userId: string,
  profile: Profile,
  entries: VaultEntry[]
): Promise<void> {
  await repo.upsertProfile(userId, profile);
  for (const entry of entries) {
    await repo.upsertVaultEntry(userId, entry);
  }
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

    await seedDemo(repo, userId, mayaDemoProfile(), mayaDemoVaultEntries());

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to start demo';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
