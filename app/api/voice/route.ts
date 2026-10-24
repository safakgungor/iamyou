/**
 * `POST /api/voice` — `{ text }` → `audio/mpeg` in the twin's voice.
 *
 * Only for a signed-in caller (the demo's anonymous session counts), text up
 * to MAX_VOICE_CHARS, and a per-user rate limit. Any failure answers with a
 * JSON error and no audio, and the client falls back to the browser's speech.
 */

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/db/supabase-server';
import { MAX_VOICE_CHARS, allowVoice, synthesize } from '@/lib/voice';

export type VoiceDeps = {
  apiKey: string | undefined;
  now: number;
  fetchImpl?: typeof fetch;
};

/** The route's logic for a known caller, separate from auth so it can be tested. */
export async function voiceResponse(deps: VoiceDeps, userId: string, body: unknown): Promise<Response> {
  const text = typeof body === 'object' && body !== null ? (body as { text?: unknown }).text : undefined;
  if (typeof text !== 'string' || !text.trim() || text.length > MAX_VOICE_CHARS) {
    return NextResponse.json({ error: 'invalid_text' }, { status: 400 });
  }
  if (!deps.apiKey) {
    return NextResponse.json({ error: 'voice_unavailable' }, { status: 503 });
  }
  if (!allowVoice(userId, deps.now)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const audio = await synthesize(text.trim(), deps.apiKey, deps.fetchImpl);
  if (!audio) {
    return NextResponse.json({ error: 'voice_unavailable' }, { status: 502 });
  }
  return new Response(audio, {
    headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' },
  });
}

export async function POST(request: Request): Promise<Response> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  return voiceResponse({ apiKey: process.env.ELEVENLABS_API_KEY, now: Date.now() }, user.id, body);
}
