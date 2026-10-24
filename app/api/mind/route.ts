/**
 * `GET /api/mind` — the caller's mind tree: their vault entries (never style
 * examples) grouped by Claude into five fixed branches, each node citing only
 * entries that exist in this vault.
 *
 * A thin shell: authenticate (401 when there is no caller), wire the
 * production collaborators, and delegate to `getMind` in `lib/mind/service`.
 * When Claude is still regrowing the tree the response is provisional with
 * `pending: true`; `after` keeps that background job alive past the response
 * so the page's next poll gets the grown tree.
 */

import { NextResponse, after } from 'next/server';

import { createSupabaseServerClient } from '@/lib/db/supabase-server';
import { SupabaseVaultRepository } from '@/lib/db/vault-repository';
import { defaultMindClaude } from '@/lib/mind/claude';
import { getMind, sharedMindCache } from '@/lib/mind/service';

export async function GET(): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const mind = await getMind(
    {
      repo: new SupabaseVaultRepository(supabase),
      claude: defaultMindClaude(),
      cache: sharedMindCache(),
      schedule: (job) => after(() => job),
    },
    user.id,
  );

  return NextResponse.json(mind, { headers: { 'Cache-Control': 'no-store' } });
}
