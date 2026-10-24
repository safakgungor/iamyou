/**
 * `DELETE /api/vault` (Req 3.5, 3.6)
 *
 * Removes every row the authenticated caller owns across all four Vault tables
 * (`profiles`, `vault_entries`, `predictions`, `answers`) and returns
 * `{ ok: true }`.
 *
 * The route handler is a thin shell: it authenticates the caller (401 when
 * there is none) and delegates the deletion to the repository-backed
 * `deleteVaultForUser` helper so it can be unit-tested with
 * `InMemoryVaultRepository` (task 16.2). The helper is named
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
  VaultDeleteResponseSchema,
  type VaultDeleteResponse,
} from '@/lib/claude/schemas';

/**
 * Deletes every row owned by `userId` via the repository, then returns the
 * validated `{ ok: true }` payload. The repository's `deleteVault` performs the
 * per-table deletes; here we only orchestrate and shape the response.
 */
export async function deleteVaultForUser(
  repo: VaultRepository,
  userId: string
): Promise<VaultDeleteResponse> {
  await repo.deleteVault(userId);
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
  const result = await deleteVaultForUser(repo, user.id);

  return NextResponse.json(result);
}
