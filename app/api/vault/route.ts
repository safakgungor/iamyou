/**
 * `DELETE /api/vault` (Req 3.5, 3.6, 6.6)
 *
 * Removes every row the authenticated caller owns across all four Vault tables
 * (`profiles`, `vault_entries`, `predictions`, `answers`) AND every Draft the
 * caller owns, then returns `{ ok: true }`. Clearing a user's vault also clears
 * their drafts so no draft reply survives a vault wipe (twin-loop property P4,
 * extended to the `drafts` table).
 *
 * The route handler is a thin shell: it authenticates the caller (401 when
 * there is none) and delegates the deletion to the repository-backed
 * `deleteVaultForUser` helper so it can be unit-tested with
 * `InMemoryVaultRepository` and `InMemoryDraftRepository`. The helper is named
 * `deleteVaultForUser` to avoid colliding with the repository's `deleteVault`
 * method.
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
  VaultDeleteResponseSchema,
  type VaultDeleteResponse,
} from '@/lib/claude/schemas';

/**
 * Deletes every row owned by `userId` via both repositories, then returns the
 * validated `{ ok: true }` payload. The vault repository's `deleteVault`
 * performs the per-table vault deletes and the draft repository's
 * `deleteAllDrafts` clears the caller's drafts; here we only orchestrate and
 * shape the response. (Req 3.5, 3.6, 6.6)
 */
export async function deleteVaultForUser(
  repo: VaultRepository,
  draftRepo: DraftRepository,
  userId: string
): Promise<VaultDeleteResponse> {
  await repo.deleteVault(userId);
  await draftRepo.deleteAllDrafts(userId);
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

  const repo = new SupabaseVaultRepository(supabase);
  const draftRepo = new SupabaseDraftRepository(supabase);
  const result = await deleteVaultForUser(repo, draftRepo, user.id);

  return NextResponse.json(result);
}
