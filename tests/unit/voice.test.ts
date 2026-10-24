import { beforeEach, describe, expect, it, vi } from 'vitest';
import { voiceResponse } from '@/app/api/voice/route';
import { MAX_VOICE_CHARS, VOICE_ID, VOICE_LIMIT, VOICE_MODEL, resetVoiceLimit } from '@/lib/voice';
import { pickBrowserVoice } from '@/components/twin-voice';

vi.mock('@/lib/db/supabase-server', () => ({ createSupabaseServerClient: vi.fn() }));

const mp3 = new Uint8Array([0xff, 0xfb, 0x90, 0x00]).buffer;
const okFetch = () => vi.fn(async () => new Response(mp3, { status: 200 })) as unknown as typeof fetch;

describe('voiceResponse', () => {
  beforeEach(() => resetVoiceLimit());

  it('returns the twin voice as mp3, asking ElevenLabs for the film voice', async () => {
    const fetchImpl = okFetch();
    const res = await voiceResponse({ apiKey: 'k', now: 0, fetchImpl }, 'u1', { text: 'Hello Maya.' });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('audio/mpeg');
    const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(url).toContain(`/text-to-speech/${VOICE_ID}`);
    expect(JSON.parse(String(init.body))).toMatchObject({ text: 'Hello Maya.', model_id: VOICE_MODEL });
  });

  it('rejects empty, non-string and over-long text without calling ElevenLabs', async () => {
    const fetchImpl = okFetch();
    for (const body of [null, {}, { text: '' }, { text: '   ' }, { text: 42 }, { text: 'x'.repeat(MAX_VOICE_CHARS + 1) }]) {
      const res = await voiceResponse({ apiKey: 'k', now: 0, fetchImpl }, 'u1', body);
      expect(res.status).toBe(400);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('answers 503 without a key, and 502 when ElevenLabs fails', async () => {
    expect((await voiceResponse({ apiKey: undefined, now: 0 }, 'u1', { text: 'hi' })).status).toBe(503);
    const failing = vi.fn(async () => new Response('no', { status: 500 })) as unknown as typeof fetch;
    expect((await voiceResponse({ apiKey: 'k', now: 0, fetchImpl: failing }, 'u1', { text: 'hi' })).status).toBe(502);
  });

  it('limits each user separately within the window', async () => {
    const fetchImpl = okFetch();
    for (let i = 0; i < VOICE_LIMIT.count; i++) {
      expect((await voiceResponse({ apiKey: 'k', now: i, fetchImpl }, 'u1', { text: 'hi' })).status).toBe(200);
    }
    expect((await voiceResponse({ apiKey: 'k', now: 100, fetchImpl }, 'u1', { text: 'hi' })).status).toBe(429);
    expect((await voiceResponse({ apiKey: 'k', now: 100, fetchImpl }, 'u2', { text: 'hi' })).status).toBe(200);
    const later = VOICE_LIMIT.windowMs + 100;
    expect((await voiceResponse({ apiKey: 'k', now: later, fetchImpl }, 'u1', { text: 'hi' })).status).toBe(200);
  });
});

describe('pickBrowserVoice', () => {
  it('prefers natural or enhanced voices in the right language', () => {
    const voices = [
      { name: 'Fred', lang: 'en-US' },
      { name: 'Google Deutsch', lang: 'de-DE' },
      { name: 'Samantha (Enhanced)', lang: 'en-US' },
      { name: 'Microsoft Aria Online (Natural)', lang: 'en-US' },
    ];
    expect(pickBrowserVoice(voices, 'en-US')?.name).toBe('Microsoft Aria Online (Natural)');
  });

  it('returns null when no voice speaks the language', () => {
    expect(pickBrowserVoice([{ name: 'Google Deutsch', lang: 'de-DE' }], 'en-US')).toBeNull();
  });
});
