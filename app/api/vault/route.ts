/**
 * `DELETE /api/vault` (Req 3.5, 3.6, 6.6; health-baseline Req 2.11)
 *
 * Removes every row the authenticated caller owns across all four Vault tables
 * (`profiles`, `vault_entries`, `predictions`, `answers`), every Draft the
 * caller owns, AND every `weekly_features` row the caller owns, then returns
 * `{ ok: true }`. Clearing a user's vault also clears their drafts and weekly
 * health history so nothing survives a vault wipe (twin-loop property P4,
 * extended to the `drafts` table and by health-baseline property P17 to the
 * `weekly_features` table).
 *
 * The route handler is a thin shell: it authenticates the caller (401 when
 * there is none) and delegates the deletion to the repository-backed
 * `deleteVaultForUser` helper so it can be unit-tested with
 * `InMemoryVaultRepository`, `InMemoryDraftRepository` and
 * `InMemoryWeeklyFeatureRepository`. The helper is named `deleteVaultForUser`
 * to avoid colliding with the repository's `deleteVault` method.
 */

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/db/supabase-server';
import {
  SupabaseVaultRepository,
  type VaultRepository,
} from '@/lib/db/vault-repository';
import {
  SupabaseDraftRepository,
  type DraftRepository,
} from '@/lib/db/draft-repository';
import {
  SupabaseWeeklyFeatureRepository,
  type WeeklyFeatureRepository,
} from '@/lib/db/weekly-feature-repository';
import {
  VaultDeleteResponseSchema,
  type VaultDeleteResponse,
} from '@/lib/claude/schemas';

/**
 * Deletes every row owned by `userId` via the three repositories, then returns
 * the validated `{ ok: true }` payload. The vault repository's `deleteVault`
 * performs the per-table vault deletes, the draft repository's
 * `deleteAllDrafts` clears the caller's drafts, and the weekly feature
 * repository's `deleteForUser` clears the caller's `weekly_features` rows;
 * here we only orchestrate and shape the response. Any rejection propagates
 * (the handler maps it to 500) and every delete is idempotent, so a retry
 * heals a partial failure. (Req 3.5, 3.6, 6.6; health-baseline Req 2.11)
 */
export async function deleteVaultForUser(
  repo: VaultRepository,
  draftRepo: DraftRepository,
  weeklyRepo: WeeklyFeatureRepository,
  userId: string
): Promise<VaultDeleteResponse> {
  await repo.deleteVault(userId); // profiles, vault_entries, predictions, answers
  await draftRepo.deleteAllDrafts(userId); // drafts
  await weeklyRepo.deleteForUser(userId); // weekly_features
  return VaultDeleteResponseSchema.parse({ ok: true });
}

export async function DELETE(): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // All three repositories run on the request-scoped client, so RLS scopes
  // every delete to the caller's own rows.
  const repo = new SupabaseVaultRepository(supabase);
  const draftRepo = new SupabaseDraftRepository(supabase);
  const weeklyRepo = new SupabaseWeeklyFeatureRepository(supabase);
  const result = await deleteVaultForUser(repo, draftRepo, weeklyRepo, user.id);

  return NextResponse.json(result);
}
