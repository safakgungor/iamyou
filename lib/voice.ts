/**
 * The twin's spoken voice: the same ElevenLabs voice as the film's narrator.
 * Server only; the API key never reaches the browser. Callers fall back to
 * the browser's own speech when this returns nothing.
 */

// Same guard as lib/claude: loading this in a browser throws instead of shipping it.
if (typeof window !== 'undefined') {
  throw new Error('lib/voice is server-only and must not run in the browser');
}

export const VOICE_ID = 'FXiGrYlEwg6j4dQQQyYr';
/** Fastest model that keeps the film voice's character (about 0.6 s to the first byte). */
export const VOICE_MODEL = 'eleven_turbo_v2_5';
/** Twin replies are a few sentences; anything longer is not a reply. */
export const MAX_VOICE_CHARS = 600;
/** Per user: enough for a demo, not enough to farm audio. */
export const VOICE_LIMIT = { count: 40, windowMs: 10 * 60 * 1000 };

const uses = new Map<string, number[]>();

/** Sliding-window limit per user. In memory, so per server instance. */
export function allowVoice(userId: string, now: number): boolean {
  const recent = (uses.get(userId) ?? []).filter((t) => now - t < VOICE_LIMIT.windowMs);
  if (recent.length >= VOICE_LIMIT.count) {
    uses.set(userId, recent);
    return false;
  }
  recent.push(now);
  uses.set(userId, recent);
  return true;
}

/** Test hook: forget every user's recent uses. */
export function resetVoiceLimit(): void {
  uses.clear();
}

/** MP3 audio of `text` in the twin's voice, or null on any failure. */
export async function synthesize(
  text: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ArrayBuffer | null> {
  try {
    const res = await fetchImpl(
      `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body: JSON.stringify({
          text,
          model_id: VOICE_MODEL,
          voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.15, use_speaker_boost: true },
        }),
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}
