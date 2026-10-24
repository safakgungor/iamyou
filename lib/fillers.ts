/** The filler tokens, in the order given by Requirement 1.6. */
export const FILLERS = [
  'um',
  'uh',
  'er',
  'like',
  'you know',
  'i mean',
  'basically',
  'actually',
] as const;

export type Filler = (typeof FILLERS)[number];

/** Two-word fillers, matched against consecutive tokens first. (Req 1.5) */
export const MULTI_WORD_FILLERS: ReadonlySet<string> = new Set<string>(
  FILLERS.filter((f) => f.includes(' ')),
);

/** One-word fillers, matched only where no multi-word filler matched. (Req 1.5) */
export const SINGLE_WORD_FILLERS: ReadonlySet<string> = new Set<string>(
  FILLERS.filter((f) => !f.includes(' ')),
);
