'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { speakAsTwin, stopTwinVoice } from './twin-voice';

// ---------------------------------------------------------------------------
// Minimal Web Speech API typings
//
// The standard TS DOM lib does not ship SpeechRecognition (it is still a draft
// spec and lives behind the `webkit` prefix in most browsers). We declare just
// enough of the surface we touch so this module type-checks under `strict`.
// ---------------------------------------------------------------------------

interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechRecognitionResult {
  readonly length: number;
  readonly isFinal: boolean;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message: string;
}

interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: ((event: Event) => void) | null;
  onstart: ((event: Event) => void) | null;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

interface SpeechWindow extends Window {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
}

function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const w = window as SpeechWindow;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function speechSynthesisAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

// ---------------------------------------------------------------------------
// Public hook
// ---------------------------------------------------------------------------

export interface UseSpeech {
  /**
   * True when the browser can transcribe speech. When false the UI should
   * render a text-input fallback for entering the answer (Req 5.3).
   */
  supported: boolean;
  /** True while a recognition session is actively listening. */
  listening: boolean;
  /** The most recent transcribed text (Req 5.1). */
  transcript: string;
  /** A recognition error string, or null when there is none. */
  error: string | null;
  /** Begin transcribing the user's spoken answer (Req 5.1). */
  listen: () => void;
  /** Stop an in-progress recognition session. */
  stop: () => void;
  /** Clear the current transcript back to an empty string. */
  reset: () => void;
  /** Speak the given text in the twin's voice, falling back to `speechSynthesis` (Req 5.2). */
  speak: (text: string) => void;
  /** Stop anything `speak` is still saying. */
  stopSpeaking: () => void;
}

export interface UseSpeechOptions {
  /** BCP-47 language tag passed to the recognizer and synthesizer. */
  lang?: string;
}

export function useSpeech(options: UseSpeechOptions = {}): UseSpeech {
  const { lang = 'en-US' } = options;

  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  // Detect support after mount so the server and first client render agree
  // (SSR safety — `window` is never touched during render).
  useEffect(() => {
    setSupported(getSpeechRecognition() !== null);
  }, []);

  // Tear down any live session on unmount.
  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
      if (speechSynthesisAvailable()) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const listen = useCallback(() => {
    const Recognition = getSpeechRecognition();
    if (!Recognition) {
      setSupported(false);
      return;
    }

    // Replace any previous session.
    recognitionRef.current?.abort();

    const recognition = new Recognition();
    recognition.lang = lang;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setError(null);
      setListening(true);
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let text = '';
      for (let i = 0; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.length > 0) {
          text += result[0].transcript;
        }
      }
      setTranscript(text.trim());
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      setError(event.error || 'speech-recognition-error');
      setListening(false);
    };

    recognition.onend = () => {
      setListening(false);
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch {
      // start() throws if called while already running; surface it gently.
      setError('speech-recognition-start-failed');
      setListening(false);
    }
  }, [lang]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  const reset = useCallback(() => {
    setTranscript('');
    setError(null);
  }, []);

  const speak = useCallback(
    (text: string) => {
      if (!text) return;
      // The film's voice, or the most natural browser voice when it can't play.
      void speakAsTwin(text, lang);
    },
    [lang],
  );

  const stopSpeaking = useCallback(() => {
    stopTwinVoice();
  }, []);

  return {
    supported,
    listening,
    transcript,
    error,
    listen,
    stop,
    reset,
    speak,
    stopSpeaking,
  };
}

export default useSpeech;
