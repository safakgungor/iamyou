// Feature: health-baseline, Property 4: Speech features are deterministic and bounded
//
// Validates: Requirements 1.7, 1.8, 1.9
//
// extractSpeechFeatures reads only its argument. For any transcript, including empty,
// whitespace-only and punctuation-only strings, this property asserts:
//   - two calls return identical values,
//   - vocabulary_diversity is in [0, 1] and filler_rate is >= 0,
//   - every value is finite, and
//   - zero tokens or zero non-empty sentences yield all three values 0.
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  extractSpeechFeatures,
  splitSentences,
  tokenize,
  type SpeechFeatures,
} from "@/lib/speech-features";

const WHITESPACE_CHARS = [" ", "\t", "\n", "\r", "\u00a0", "\u2003", "\u3000"];
const PUNCTUATION_CHARS = [".", "!", "?", ",", ";", ":", "-", "…", "'", '"', "(", ")", "*"];

const whitespaceOnlyArb = fc.string({
  unit: fc.constantFrom(...WHITESPACE_CHARS),
  maxLength: 20,
});

// Punctuation interleaved with whitespace: still no word characters.
const punctuationOnlyArb = fc.string({
  unit: fc.constantFrom(...PUNCTUATION_CHARS, ...WHITESPACE_CHARS),
  minLength: 1,
  maxLength: 20,
});

const transcriptArb = fc.oneof(
  fc.string({ unit: "grapheme", maxLength: 200 }),
  fc.constant(""),
  whitespaceOnlyArb,
  punctuationOnlyArb
);

const ZERO: SpeechFeatures = {
  vocabulary_diversity: 0,
  mean_sentence_length: 0,
  filler_rate: 0,
};

describe("extractSpeechFeatures", () => {
  it("Property 4: is deterministic and bounded, and all-zero without tokens or sentences", () => {
    fc.assert(
      fc.property(transcriptArb, (transcript) => {
        const first = extractSpeechFeatures(transcript);
        const second = extractSpeechFeatures(transcript);

        // Req 1.9: identical values across two separate computations.
        expect(second).toStrictEqual(first);

        // Req 1.8: bounds; every value is finite.
        for (const value of Object.values(first)) {
          expect(Number.isFinite(value)).toBe(true);
        }
        expect(first.vocabulary_diversity).toBeGreaterThanOrEqual(0);
        expect(first.vocabulary_diversity).toBeLessThanOrEqual(1);
        expect(first.filler_rate).toBeGreaterThanOrEqual(0);

        // Req 1.7: zero tokens or zero non-empty sentences yield all zeros.
        if (
          tokenize(transcript).length === 0 ||
          splitSentences(transcript).length === 0
        ) {
          expect(first).toStrictEqual(ZERO);
        }
        // A transcript with no letter or digit can produce no token at all.
        if (!/[\p{L}\p{N}]/u.test(transcript)) {
          expect(first).toStrictEqual(ZERO);
        }
      }),
      { numRuns: 200 }
    );
  });

  // Feature: health-baseline, Property 8: Speech features follow their definitions
  //
  // Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5
  //
  // The transcript is built from a known structure (words, separators, sentence breaks),
  // so the reference reads tokens and sentences off the structure instead of re-parsing
  // the string. Every separator ends in whitespace, so each generated word is exactly one
  // token. The reference recomputes each MATTR window with a fresh Set and scans fillers
  // with a hard-coded list from Requirement 1.6.
  it("Property 8: follows the MATTR/TTR, sentence-length and filler definitions, case-insensitively", () => {
    fc.assert(
      fc.property(structuredTranscriptArb, ({ transcript, words, sentenceSizes }) => {
        const actual = extractSpeechFeatures(transcript);
        const expected = referenceFeatures(words, sentenceSizes);

        expect(actual.vocabulary_diversity).toBeCloseTo(expected.vocabulary_diversity, 10);
        expect(actual.mean_sentence_length).toBeCloseTo(expected.mean_sentence_length, 10);
        expect(actual.filler_rate).toBeCloseTo(expected.filler_rate, 10);

        // Changing the case of the transcript does not change the result.
        expect(extractSpeechFeatures(transcript.toUpperCase())).toStrictEqual(actual);
        expect(extractSpeechFeatures(transcript.toLowerCase())).toStrictEqual(actual);
      }),
      { numRuns: 300 }
    );
  });
});

// ---------------------------------------------------------------------------
// P8 generators and naive reference
// ---------------------------------------------------------------------------

const FILLER_PARTS = ["um", "uh", "er", "like", "you", "know", "i", "mean", "basically", "actually"];
const OTHER_WORDS = ["the", "cat", "ran", "knew", "means", "ok", "so", "we", "liked", "umm"];

const P8_WHITESPACE = [" ", "\t", "\n", "\r\n", "\u00a0", "\u2003"];

const wordArb = fc.oneof(
  { arbitrary: fc.constantFrom(...FILLER_PARTS), weight: 3 },
  { arbitrary: fc.constantFrom(...OTHER_WORDS), weight: 1 }
);

/** Random per-character case, e.g. "you" -> "yOU". */
const mixedCaseWordArb = wordArb.chain((word) =>
  fc
    .array(fc.boolean(), { minLength: word.length, maxLength: word.length })
    .map((upper) => ({
      word,
      text: [...word].map((ch, i) => (upper[i] ? ch.toUpperCase() : ch)).join(""),
    }))
);

const wsRunArb = fc
  .array(fc.constantFrom(...P8_WHITESPACE), { minLength: 1, maxLength: 3 })
  .map((parts) => parts.join(""));
const optWsArb = fc.oneof(fc.constant(""), wsRunArb);
/** A run of 1–4 sentence terminators; runs longer than 1 create empty segments. */
const terminatorRunArb = fc
  .array(fc.constantFrom(".", "!", "?"), { minLength: 1, maxLength: 4 })
  .map((parts) => parts.join(""));

type Separator = { text: string; breaks: boolean };

/** Always ends in whitespace so adjacent words never merge into one token. */
const separatorArb: fc.Arbitrary<Separator> = fc.oneof(
  { arbitrary: wsRunArb.map((text) => ({ text, breaks: false })), weight: 3 },
  {
    arbitrary: fc
      .tuple(optWsArb, terminatorRunArb, wsRunArb)
      .map(([a, t, b]) => ({ text: a + t + b, breaks: true })),
    weight: 1,
  }
);

/** Leading/trailing junk: whitespace and terminator runs, possibly empty. */
const edgeArb: fc.Arbitrary<Separator> = fc.oneof(
  optWsArb.map((text) => ({ text, breaks: false })),
  fc
    .tuple(optWsArb, terminatorRunArb, optWsArb)
    .map(([a, t, b]) => ({ text: a + t + b, breaks: true }))
);

type Structured = { transcript: string; words: string[]; sentenceSizes: number[] };

const structuredTranscriptArb: fc.Arbitrary<Structured> = fc
  .tuple(
    edgeArb,
    fc.array(fc.tuple(mixedCaseWordArb, separatorArb), { minLength: 0, maxLength: 120 }),
    edgeArb
  )
  .map(([lead, items, trail]) => {
    let transcript = lead.text;
    const words: string[] = [];
    const sentenceSizes: number[] = [];
    let current = 0;
    items.forEach(([w, sep], idx) => {
      transcript += w.text;
      words.push(w.word);
      current++;
      // The last word is followed by the trailing edge instead of its separator.
      if (idx < items.length - 1) {
        transcript += sep.text;
        if (sep.breaks) {
          sentenceSizes.push(current);
          current = 0;
        }
      }
    });
    transcript += trail.text;
    if (current > 0) sentenceSizes.push(current);
    return { transcript, words, sentenceSizes };
  });

/** Naive reference built only from the generated structure. */
function referenceFeatures(words: string[], sentenceSizes: number[]): SpeechFeatures {
  const n = words.length;
  const nonEmpty = sentenceSizes.filter((s) => s > 0);
  if (n === 0 || nonEmpty.length === 0) return ZERO;

  let vocabulary_diversity: number;
  if (n >= 50) {
    let sum = 0;
    let windows = 0;
    for (let i = 0; i + 50 <= n; i++) {
      sum += new Set(words.slice(i, i + 50)).size / 50;
      windows++;
    }
    vocabulary_diversity = sum / windows;
  } else {
    vocabulary_diversity = new Set(words).size / n;
  }

  const mean_sentence_length = nonEmpty.reduce((a, b) => a + b, 0) / nonEmpty.length;

  const twoWord = [
    ["you", "know"],
    ["i", "mean"],
  ];
  const oneWord = ["um", "uh", "er", "like", "basically", "actually"];
  let count = 0;
  let i = 0;
  while (i < n) {
    if (i + 1 < n && twoWord.some(([a, b]) => words[i] === a && words[i + 1] === b)) {
      count++;
      i += 2;
      continue;
    }
    if (oneWord.includes(words[i])) count++;
    i++;
  }

  return { vocabulary_diversity, mean_sentence_length, filler_rate: (100 * count) / n };
}
