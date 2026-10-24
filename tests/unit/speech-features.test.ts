import { describe, expect, it } from 'vitest';
import { FILLERS } from '@/lib/fillers';
import { MATTR_WINDOW, extractSpeechFeatures, tokenize } from '@/lib/speech-features';

const ZEROS = { vocabulary_diversity: 0, mean_sentence_length: 0, filler_rate: 0 };

describe('FILLERS (Req 1.6)', () => {
  it('lists the eight fillers in order', () => {
    expect([...FILLERS]).toEqual([
      'um',
      'uh',
      'er',
      'like',
      'you know',
      'i mean',
      'basically',
      'actually',
    ]);
  });
});

describe('tokenize (Req 1.1, 1.5)', () => {
  it('lowercases and trims edge punctuation', () => {
    expect(tokenize('um, I mean... like.')).toEqual(['um', 'i', 'mean', 'like']);
  });
});

describe('filler_rate (Req 1.5)', () => {
  it('counts "you know like" as 2 fillers in 3 tokens', () => {
    expect(tokenize('you know like')).toHaveLength(3);
    expect(extractSpeechFeatures('you know like').filler_rate).toBeCloseTo((2 / 3) * 100, 10);
  });
});

describe('empty transcripts (Req 1.7)', () => {
  it.each(['', '   ', '?!.'])('returns all zeros for %j', (transcript) => {
    expect(extractSpeechFeatures(transcript)).toEqual(ZEROS);
  });
});

describe('vocabulary_diversity MATTR (Req 1.2)', () => {
  it('matches a hand-computed value for a 60-token sample', () => {
    // 50 distinct words w1..w50, then "a" ten times: 60 tokens, 11 windows of 50.
    // Window 0 has 50 types; window k (1..10) has w(k+1)..w50 plus "a" = 51 - k types.
    // Sum = 50 + (50 + 49 + ... + 41) = 50 + 455 = 505; MATTR = 505 / (11 * 50) = 101 / 110.
    const words = Array.from({ length: 50 }, (_, i) => `w${i + 1}`);
    const transcript = `${[...words, ...Array(10).fill('a')].join(' ')}.`;
    expect(MATTR_WINDOW).toBe(50);
    expect(tokenize(transcript)).toHaveLength(60);

    const features = extractSpeechFeatures(transcript);
    expect(features.vocabulary_diversity).toBeCloseTo(101 / 110, 12);
    // Differs from the plain type-token ratio (51 / 60), so the window is in use.
    expect(features.vocabulary_diversity).not.toBeCloseTo(51 / 60, 3);
  });
});
