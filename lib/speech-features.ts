/**
 * Deterministic speech features for the health-baseline. No model, no I/O.
 *
 * `extractSpeechFeatures` reads only its argument and uses only arithmetic, so
 * the same transcript always yields identical values (Req 1.9). It is the
 * target of property tests P4 and P8.
 */
import { MULTI_WORD_FILLERS, SINGLE_WORD_FILLERS } from './fillers';

export type SpeechFeatures = {
  vocabulary_diversity: number; // [0, 1]
  mean_sentence_length: number; // >= 0
  filler_rate: number; // >= 0, fillers per 100 tokens
};

/** The moving-average window for vocabulary_diversity. (Req 1.2) */
export const MATTR_WINDOW = 50;

/** Leading and trailing characters that are not letters or digits. */
const EDGE_NON_WORD = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
const WHITESPACE = /\s+/;
const SENTENCE_END = /[.!?]/;

/** Whitespace-delimited, lowercased word tokens. (Req 1.1) */
export function tokenize(text: string): string[] {
  // `toLowerCase` is locale-independent, unlike `toLocaleLowerCase`.
  const tokens: string[] = [];
  for (const chunk of text.toLowerCase().split(WHITESPACE)) {
    // Trim edge punctuation so that "um," still matches the filler "um".
    const token = chunk.replace(EDGE_NON_WORD, '');
    if (token.length > 0) tokens.push(token);
  }
  return tokens;
}

/** Segments from splitting on '.', '!', '?', with zero-token segments removed. (Req 1.4) */
export function splitSentences(text: string): string[][] {
  const sentences: string[][] = [];
  for (const segment of text.split(SENTENCE_END)) {
    const tokens = tokenize(segment);
    if (tokens.length > 0) sentences.push(tokens);
  }
  return sentences;
}

/**
 * Moving-average type-token ratio over every MATTR_WINDOW-token window when
 * there are at least MATTR_WINDOW tokens, else the plain type-token ratio.
 * Requires `tokens.length >= 1`. (Req 1.2, 1.3, 1.8)
 */
function vocabularyDiversity(tokens: readonly string[]): number {
  const n = tokens.length;
  if (n < MATTR_WINDOW) return new Set(tokens).size / n;

  // Sliding count map: O(n). Distinct counts are summed as integers, so the
  // final ratio is at most windows * MATTR_WINDOW / (windows * MATTR_WINDOW) = 1.
  const counts = new Map<string, number>();
  for (let i = 0; i < MATTR_WINDOW; i++) {
    counts.set(tokens[i], (counts.get(tokens[i]) ?? 0) + 1);
  }
  let distinctSum = counts.size;
  const windows = n - MATTR_WINDOW + 1;
  for (let i = 1; i < windows; i++) {
    const leaving = tokens[i - 1];
    const left = (counts.get(leaving) ?? 0) - 1;
    if (left === 0) counts.delete(leaving);
    else counts.set(leaving, left);
    const entering = tokens[i + MATTR_WINDOW - 1];
    counts.set(entering, (counts.get(entering) ?? 0) + 1);
    distinctSum += counts.size;
  }
  return distinctSum / (windows * MATTR_WINDOW);
}

/**
 * Number of filler occurrences, matching two-word fillers before single-word
 * ones so a token sequence counts at most once. (Req 1.5)
 */
function countFillers(tokens: readonly string[]): number {
  const n = tokens.length;
  let count = 0;
  let i = 0;
  while (i < n) {
    if (i + 1 < n && MULTI_WORD_FILLERS.has(`${tokens[i]} ${tokens[i + 1]}`)) {
      count++;
      i += 2;
    } else {
      if (SINGLE_WORD_FILLERS.has(tokens[i])) count++;
      i += 1;
    }
  }
  return count;
}

/** Pure, deterministic, no model, no I/O. (Req 1.1–1.9 / P4, P8) */
export function extractSpeechFeatures(transcript: string): SpeechFeatures {
  const tokens = tokenize(transcript);
  const sentences = splitSentences(transcript);
  const n = tokens.length;

  // Return before any division. (Req 1.7)
  if (n === 0 || sentences.length === 0) {
    return { vocabulary_diversity: 0, mean_sentence_length: 0, filler_rate: 0 };
  }

  let sentenceTokens = 0;
  for (const sentence of sentences) sentenceTokens += sentence.length;

  return {
    vocabulary_diversity: vocabularyDiversity(tokens),
    mean_sentence_length: sentenceTokens / sentences.length,
    filler_rate: (countFillers(tokens) / n) * 100,
  };
}
