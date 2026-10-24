'use client';

/**
 * The twin speaks in the film's voice: `POST /api/voice` returns ElevenLabs
 * audio, played through a light version of the film's voice chain (two short
 * echo taps, a little presence). If that fails or takes too long, the best
 * voice the browser has reads the text instead.
 */

type VoiceLike = { name: string; lang: string; localService?: boolean };

// Neural online voices (Edge, Chrome) sound best, then Apple's enhanced and premium ones.
const NEURAL = /natural|neural|online|wavenet/i;
const ENHANCED = /premium|enhanced/i;
const KNOWN_GOOD = /google us english|google uk english female|samantha|ava|allison|aria|jenny|serena|zoe|karen|moira/i;

/** The most natural-sounding voice for `lang`, or null when there is none. */
export function pickBrowserVoice<V extends VoiceLike>(voices: readonly V[], lang = 'en-US'): V | null {
  const family = lang.slice(0, 2).toLowerCase();
  let best: V | null = null;
  let bestScore = -1;
  for (const v of voices) {
    if (!v.lang.toLowerCase().startsWith(family)) continue;
    let score = 0;
    if (NEURAL.test(v.name)) score += 5;
    else if (ENHANCED.test(v.name)) score += 4;
    if (KNOWN_GOOD.test(v.name)) score += 2;
    if (v.lang.toLowerCase() === lang.toLowerCase()) score += 1;
    if (score > bestScore) {
      best = v;
      bestScore = score;
    }
  }
  return best;
}

let ctx: AudioContext | null = null;
let current: { stop: () => void } | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx ??= new Ctor();
  return ctx;
}

/** Call from a tap or click: mobile browsers only let audio start after a user gesture. */
export function unlockTwinVoice(): void {
  const c = audioContext();
  if (c && c.state === 'suspended') void c.resume();
}

// The first tap anywhere unlocks audio, so a reply that arrives later can still play.
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', unlockTwinVoice, { once: true, capture: true });
}

/** Stops whatever the twin is saying, in either voice. */
export function stopTwinVoice(): void {
  current?.stop();
  current = null;
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
}

function speakInBrowser(text: string, lang: string): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  const synth = window.speechSynthesis;
  const utter = () => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    const voice = pickBrowserVoice(synth.getVoices(), lang);
    if (voice) u.voice = voice;
    u.rate = 1;
    u.pitch = 1;
    synth.speak(u);
  };
  synth.cancel();
  // Some browsers load voices late; wait for them once, briefly.
  if (synth.getVoices().length) utter();
  else {
    const t = setTimeout(utter, 400);
    synth.addEventListener('voiceschanged', () => (clearTimeout(t), utter()), { once: true });
  }
}

async function playThroughChain(c: AudioContext, data: ArrayBuffer): Promise<void> {
  const buffer = await c.decodeAudioData(data);
  const src = c.createBufferSource();
  src.buffer = buffer;

  const highpass = c.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 90;
  const presence = c.createBiquadFilter();
  presence.type = 'peaking';
  presence.frequency.value = 4500;
  presence.Q.value = 1.2;
  presence.gain.value = 3;

  src.connect(highpass).connect(presence);
  presence.connect(c.destination);
  // The film's two echo taps, quieter: it should sound like the same voice, not a hall.
  for (const [delay, gain] of [[0.038, 0.16], [0.074, 0.08]] as const) {
    const d = c.createDelay(0.2);
    d.delayTime.value = delay;
    const g = c.createGain();
    g.gain.value = gain;
    presence.connect(d).connect(g).connect(c.destination);
  }

  src.start();
  current = { stop: () => src.stop() };
}

/** Speak `text` as the twin. Never throws; the browser voice is the safety net. */
export async function speakAsTwin(text: string, lang = 'en-US'): Promise<void> {
  stopTwinVoice();
  if (!text.trim()) return;
  const c = audioContext();
  try {
    if (!c) throw new Error('no audio context');
    if (c.state === 'suspended') await c.resume();
    const res = await fetch('/api/voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`voice ${res.status}`);
    await playThroughChain(c, await res.arrayBuffer());
  } catch {
    speakInBrowser(text, lang);
  }
}
