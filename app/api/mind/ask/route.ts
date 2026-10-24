/**
 * `POST /api/mind/ask` — "Ask about yourself". Answers a question only from
 * the caller's own vault and returns the entries it quotes.
 *
 * A thin shell: authenticate (401), validate `{ question }` (400, at most 280
 * characters), and delegate to `askMind` in `lib/mind/service`, which applies
 * the safety rules: crisis language gets the 988 support message, genetic
 * testing the genetic counselor, and the twin never reads health into the
 * vault.
 */

import { NextResponse } from 'next/server';

import { createSupabaseServerClient } from '@/lib/db/supabase-server';
import { SupabaseVaultRepository } from '@/lib/db/vault-repository';
import { defaultMindClaude } from '@/lib/mind/claude';
import { MindAskRequestSchema } from '@/lib/mind/schemas';
import { askMind } from '@/lib/mind/service';

export async function POST(request: Request): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = MindAskRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const answer = await askMind(
    { repo: new SupabaseVaultRepository(supabase), claude: defaultMindClaude() },
    user.id,
    parsed.data.question,
  );

  return NextResponse.json(answer);
}
