/**
 * The deterministic half of the mind tree. Pure functions, no I/O.
 *
 *  - `vaultVersion` fingerprints a vault, so a new check-in correction changes
 *    the version and regrows the tree.
 *  - `classifyEntry`, `labelFor`, `factFor` and `fallbackTree` sort entries into
 *    the five branches by keyword when Claude is unavailable, so the screen
 *    never breaks.
 *  - `sanitizeTree` is the one gate every tree passes through, from Claude or
 *    not: it keeps only ids that exist in this vault and are not style
 *    examples, uses each entry once, trims labels and facts, and places any
 *    entry the tree missed by keyword. (Property-tested in tests/pbt.)
 *  - `searchVault` is the keyword fallback for "Ask about yourself".
 */

import type { VaultEntry } from '../db/vault-repository';
import type { ClaudeTree } from './schemas';
import {
  BRANCHES,
  eligibleEntries,
  type BranchId,
  type MindNode,
  type MindTree,
} from './types';

/* -------------------------------------------------------------------------- */
/* Hashing and versions                                                       */
/* -------------------------------------------------------------------------- */

/** 32-bit FNV-1a, base 36. Short, stable ids; not a security hash. */
export function hashString(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Fingerprint of the vault the tree is grown from: entry count, newest
 * `createdAt`, and a hash of every id and text. Any added, removed or edited
 * entry changes it.
 */
export function vaultVersion(entries: readonly VaultEntry[]): string {
  const eligible = eligibleEntries(entries);
  const newest = eligible.reduce((max, e) => (e.createdAt > max ? e.createdAt : max), '');
  const digest = hashString(
    eligible
      .map((e) => `${e.id}\u0000${e.text}`)
      .sort()
      .join('\u0001'),
  );
  return `${eligible.length}.${newest.slice(0, 10) || '0'}.${digest}`;
}

/** Stable node id: its branch plus the entries it holds. */
export function nodeId(branch: BranchId, entryIds: readonly string[]): string {
  return `${branch}-${hashString([...entryIds].sort().join('|'))}`;
}

/* -------------------------------------------------------------------------- */
/* Keyword classification                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Keywords per branch, matched as whole words (a trailing `*` matches any
 * ending). Relationship words weigh more: a story about Dad and his tomato
 * seeds is a family memory before it is a gardening one.
 */
const KEYWORDS: Record<BranchId, { weight: number; words: string[] }> = {
  family: {
    weight: 1.5,
    words: [
      'mom', 'mother', 'dad', 'father', 'parent*', 'sister*', 'brother*', 'sibling*',
      'daughter*', 'son', 'sons', 'kid', 'kids', 'child', 'children', 'baby', 'born',
      'grandma', 'grandpa', 'grandmother', 'grandfather', 'family', 'wife', 'husband',
      'partner', 'wedding', 'married', 'friend', 'friends', 'birthday', 'christmas',
      'thanksgiving', 'tradition*', 'cousin*', 'aunt', 'uncle', 'niece', 'nephew',
    ],
  },
  body: {
    weight: 1,
    words: [
      'run', 'runs', 'running', 'ran', 'runner', 'marathon', 'race', 'mile', 'miles',
      'bike', 'cycling', 'swim*', 'yoga', 'gym', 'hike', 'hiking', 'sport*', 'soccer',
      'tennis', 'climb*', 'sleep', 'slept', 'energy', 'tired', 'coffee', 'tea',
      'pancakes', 'cook', 'cooking', 'garden*', 'music', 'guitar', 'piano', 'paint*',
      'saturday', 'weekend', 'morning person', 'night owl', 'hobby', 'hobbies',
    ],
  },
  mind: {
    weight: 1,
    words: [
      'study', 'studying', 'studied', 'school', 'college', 'university', 'class',
      'classes', 'exam', 'exams', 'professor', 'pre-med', 'neuroscience', 'brain',
      'major', 'learn*', 'reading', 'book', 'books', 'research*', 'science',
      'curious', 'degree', 'thesis', 'homework', 'questions',
    ],
  },
  work: {
    weight: 1,
    words: [
      'job', 'jobs', 'work', 'working', 'career', 'boss', 'team', 'office', 'title',
      'promotion', 'salary', 'money', 'deadline', 'project', 'client*', 'shift',
      'interview', 'hired', 'company', 'colleague*', 'manager', 'meeting*', 'business',
    ],
  },
  values: {
    weight: 1,
    words: [
      'decision*', 'decide*', 'choose', 'option*', 'honest*', 'kindness', 'kind',
      'proud', 'prouder', 'trust', 'believe', 'respect', 'plan', 'wish', 'conflict',
      'angry', 'help', 'advice', 'fine', 'changed their mind', 'late', 'spontaneity',
      'conclusion', 'hard conversation*', 'patience', 'promise', 'value*', 'fair',
    ],
  },
};

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** One regex per keyword, compiled once. */
const MATCHERS: Record<BranchId, Array<{ word: string; re: RegExp }>> = Object.fromEntries(
  BRANCHES.map(({ id }) => [
    id,
    KEYWORDS[id].words.map((word) => {
      const stem = word.endsWith('*') ? word.slice(0, -1) : word;
      const tail = word.endsWith('*') ? "[\\w'-]*" : '';
      return { word: stem, re: new RegExp(`\\b${escapeRegExp(stem)}${tail}\\b`, 'i') };
    }),
  ]),
) as Record<BranchId, Array<{ word: string; re: RegExp }>>;

/** Opinions and corrections lean toward character; stories toward family. */
const KIND_PRIOR: Partial<Record<VaultEntry['kind'], Partial<Record<BranchId, number>>>> = {
  opinion: { values: 0.75 },
  correction: { values: 0.75 },
  story: { family: 0.25 },
};

/** Picks the branch an entry most belongs to by keyword. */
export function classifyEntry(entry: Pick<VaultEntry, 'kind' | 'text'>): BranchId {
  const text = entry.text;
  let best: BranchId = entry.kind === 'story' ? 'family' : 'values';
  let bestScore = 0;
  for (const { id } of BRANCHES) {
    const hits = MATCHERS[id].filter(({ re }) => re.test(text)).length;
    const score = hits * KEYWORDS[id].weight + (KIND_PRIOR[entry.kind]?.[id] ?? 0);
    if (score > bestScore) {
      best = id;
      bestScore = score;
    }
  }
  return best;
}

/* -------------------------------------------------------------------------- */
/* Labels and facts                                                           */
/* -------------------------------------------------------------------------- */

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'my', 'our', 'your', 'his', 'her', 'their', 'i', 'me', 'we',
  'to', 'of', 'and', 'or', 'but', 'is', 'was', 'be', 'it', 'that', 'this', 'for',
  'in', 'on', 'at', 'with', 'as', 'so', 'if', 'when', 'from', 'by',
]);

/** Words that make a keyword a better label when they come right before it. */
const LEAD_WORDS = new Set([
  'first', 'last', 'long', 'short', 'good', 'bad', 'big', 'little', 'half',
  'free', 'best', 'new', 'old', 'two', 'three', 'hard', 'late', 'early',
]);

/** A check-in's "Q: … A: …" split; null for any other entry. */
function checkIn(text: string): { question: string; answer: string } | null {
  const match = text.match(/^\s*Q:\s*([\s\S]+?)\s*A:\s*([\s\S]+)$/);
  return match ? { question: match[1].trim(), answer: match[2].trim() } : null;
}

/** The part of an entry that carries the fact: a check-in's answer, unquoted. */
function coreText(entry: Pick<VaultEntry, 'kind' | 'text'>): string {
  const text = checkIn(entry.text)?.answer ?? entry.text.trim();
  return text.replace(/^['"\u2018\u201c]+|['"\u2019\u201d]+$/g, '').trim();
}

function firstSentence(text: string): string {
  const match = text.match(/^[\s\S]*?[.!?](?=\s|$)/);
  return (match ? match[0] : text).trim();
}

/** Drops a leading "When I was twelve," or "No," so the sentence starts at its point. */
function mainClause(sentence: string): string {
  return sentence
    .replace(/^(no|so|well|of course|honestly|yes),?\s+/i, '')
    .replace(/^(when|after|before|while|if|once|the first time)\b[^,]{0,40},\s*/i, '');
}

/** "What's the first thing you'd do with a free Saturday?" → "Free Saturday". */
function questionTopic(question: string): string {
  const q = question.replace(/[?.!]+$/, '').trim();
  if (!/^(what|who|how|which|when|where|why)\b/i.test(q)) return q;
  const tokens = words(q);
  let start = 0;
  tokens.forEach((t, i) => {
    if (['with', 'about', 'if', 'on', 'for', 'tell', 'call'].includes(t.toLowerCase())) start = i + 1;
  });
  const topic = tokens.slice(start).filter((t, i) => i > 0 || !STOP_WORDS.has(t.toLowerCase()));
  return topic.length > 0 ? topic.slice(-4).join(' ') : tokens.slice(-3).join(' ');
}

function words(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Collapses whitespace, drops trailing punctuation, keeps at most 5 words. */
export function cleanLabel(text: string): string {
  const cleaned = text
    .replace(/\s+/g, ' ')
    // Quotes would be left unbalanced by the cut, so drop the quote marks.
    .replace(/(^|\s)['"‘“]+/g, '$1')
    .replace(/['"’”]+(?=\s|$)/g, '')
    .replace(/[\s.,;:!?—-]+$/, '')
    .trim();
  return words(cleaned).slice(0, 5).join(' ').slice(0, 48).trim();
}

/** One line, at most ~160 characters, cut on a word. */
export function cleanFact(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  if (line.length <= 160) return line;
  const cut = line.slice(0, 157);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 100 ? cut.lastIndexOf(' ') : 157)}…`;
}

/** Family words name a person, not a topic, so they never make a label alone. */
const PERSON_WORDS = new Set([
  'mom', 'mother', 'dad', 'father', 'parent', 'sister', 'brother', 'sibling',
  'daughter', 'son', 'sons', 'kid', 'kids', 'child', 'children', 'baby',
  'grandma', 'grandpa', 'grandmother', 'grandfather', 'wife', 'husband',
  'partner', 'friend', 'friends', 'cousin', 'aunt', 'uncle', 'niece', 'nephew',
]);

/**
 * A 2–5 word label for one entry, from its own words: a check-in's topic
 * ("Free Saturday"), a short sentence as-is ("I don't hate spontaneity"), the
 * branch keyword in context ("First marathon in Burlington", "Job in
 * Seattle"), else the sentence's opening words.
 */
export function labelFor(entry: Pick<VaultEntry, 'kind' | 'text'>, branch = classifyEntry(entry)): string {
  const qa = checkIn(entry.text);
  if (qa) return cleanLabel(capitalize(questionTopic(qa.question)));

  const sentence = mainClause(firstSentence(coreText(entry)))
    .replace(/[.!?]+$/, '')
    .replace(/^([^:]{6,}):\s[\s\S]*$/, '$1'); // "Our Christmas Eve tradition: …"
  const sentenceWords = words(sentence);
  if (sentenceWords.length >= 2 && sentenceWords.length <= 5) {
    return cleanLabel(capitalize(sentence));
  }

  const lower = sentenceWords.map((t) => t.toLowerCase().replace(/[^\w'-]/g, ''));
  for (const { word } of MATCHERS[branch]) {
    if (PERSON_WORDS.has(word)) continue;
    const parts = word.toLowerCase().split(' ');
    const at = lower.findIndex((_, i) => parts.every((p, j) => lower[i + j]?.startsWith(p)));
    if (at < 0) continue;
    const phrase = lower.slice(at, at + parts.length);
    if (LEAD_WORDS.has(lower[at - 1] ?? '')) phrase.unshift(lower[at - 1]);
    const prep = lower[at + parts.length];
    const next = sentenceWords[at + parts.length + 1];
    if (['in', 'at', 'from'].includes(prep ?? '') && next && /^[A-Z]/.test(next)) {
      phrase.push(prep, next.replace(/[^\w'-]/g, ''));
    }
    if (phrase.length >= 2) return cleanLabel(capitalize(phrase.join(' ')));
  }

  const head = sentenceWords.slice(0, 5);
  while (head.length > 2 && STOP_WORDS.has(head[head.length - 1].toLowerCase())) head.pop();
  return cleanLabel(capitalize(head.join(' ')));
}

/**
 * The one-line fact for one entry: its first sentence, or a check-in's whole
 * answer when the first sentence is too short to stand alone ("Mom.").
 */
export function factFor(entry: Pick<VaultEntry, 'kind' | 'text'>): string {
  const core = coreText(entry);
  const sentence = firstSentence(core);
  return cleanFact(words(sentence).length < 5 ? core : sentence);
}

/* -------------------------------------------------------------------------- */
/* Trees                                                                      */
/* -------------------------------------------------------------------------- */

/** For an entry with no words to build a label or fact from. */
const UNTITLED_LABEL = 'Something you said';
const UNTITLED_FACT = 'Something you told me.';

function emptyBranches(): Record<BranchId, MindNode[]> {
  return { family: [], body: [], mind: [], work: [], values: [] };
}

function byAge(entries: Map<string, VaultEntry>) {
  const first = (n: MindNode) =>
    n.entry_ids.map((id) => entries.get(id)?.createdAt ?? '').sort()[0] ?? '';
  return (a: MindNode, b: MindNode) => first(a).localeCompare(first(b)) || a.id.localeCompare(b.id);
}

/**
 * The single gate for every tree. Given any proposed grouping (Claude's, an
 * older cached tree, or nothing), returns a tree that:
 *   - has exactly the five branches in `BRANCHES` order;
 *   - cites only ids of this vault's non-style entries, each entry once;
 *   - drops nodes left with no entries, trims labels to ≤5 words and facts to
 *     one line;
 *   - places every entry the proposal missed as its own keyword node.
 * Nodes in a branch are ordered by their oldest entry, so the tree grows in
 * the order the person lived it.
 */
export function sanitizeTree(proposal: ClaudeTree | null, entries: readonly VaultEntry[]): MindTree {
  const eligible = new Map(eligibleEntries(entries).map((e) => [e.id, e]));
  const used = new Set<string>();
  const nodes = emptyBranches();

  for (const branch of proposal?.branches ?? []) {
    if (!Object.hasOwn(nodes, branch.branch)) continue;
    for (const node of branch.nodes) {
      const ids = [...new Set(node.entry_ids)].filter((id) => eligible.has(id) && !used.has(id));
      if (ids.length === 0) continue;
      ids.forEach((id) => used.add(id));
      const first = eligible.get(ids[0])!;
      nodes[branch.branch].push({
        id: nodeId(branch.branch, ids),
        label: cleanLabel(node.label) || labelFor(first, branch.branch) || UNTITLED_LABEL,
        fact: cleanFact(node.fact) || factFor(first) || UNTITLED_FACT,
        entry_ids: ids,
      });
    }
  }

  for (const entry of eligible.values()) {
    if (used.has(entry.id)) continue;
    const branch = classifyEntry(entry);
    nodes[branch].push({
      id: nodeId(branch, [entry.id]),
      label: labelFor(entry, branch) || UNTITLED_LABEL,
      fact: factFor(entry) || UNTITLED_FACT,
      entry_ids: [entry.id],
    });
  }

  const order = byAge(eligible);
  return {
    branches: BRANCHES.map(({ id, label }) => ({ id, label, nodes: nodes[id].sort(order) })),
  };
}

/** The keyword-only tree: one node per entry. */
export function fallbackTree(entries: readonly VaultEntry[]): MindTree {
  return sanitizeTree(null, entries);
}

/** Turns a sanitized tree back into a proposal, e.g. to regrow from it. */
export function treeAsProposal(tree: MindTree): ClaudeTree {
  return {
    branches: tree.branches.map((b) => ({
      branch: b.id,
      nodes: b.nodes.map(({ label, fact, entry_ids }) => ({ label, fact, entry_ids })),
    })),
  };
}

/** How many distinct entries the tree holds: the "Learned N things" count. */
export function learnedCount(tree: MindTree): number {
  return new Set(tree.branches.flatMap((b) => b.nodes.flatMap((n) => n.entry_ids))).size;
}

/* -------------------------------------------------------------------------- */
/* Keyword search for "Ask about yourself"                                    */
/* -------------------------------------------------------------------------- */

const QUESTION_WORDS = new Set([
  ...STOP_WORDS,
  'what', 'who', 'whom', 'when', 'where', 'why', 'how', 'which', 'do', 'does',
  'did', 'am', 'are', 'were', 'have', 'has', 'had', 'about', 'ever', 'say',
  'said', 'tell', 'told', 'think', 'thought', 'feel', 'felt', 'you', 'myself',
  'there', 'any', 'anything', 'something', 'thing', 'things', 'can', 'could',
  'would', 'should', 'will', 'just', 'like', 'really', 'much', 'many', 'know',
]);

/** A crude English stem, enough for "running" to meet "run" and "runs". */
function stem(word: string): string {
  const base = word.replace(/'s$/, '').replace(/(ing|ed|es|s)$/, '');
  const short = base.length >= 3 ? base : word;
  return /([b-df-hj-np-tv-z])\1$/.test(short) ? short.slice(0, -1) : short;
}

function terms(text: string): string[] {
  return words(text.toLowerCase().replace(/[^\w\s'-]/g, ' '))
    .filter((w) => w.length > 2 && !QUESTION_WORDS.has(w.replace(/'s$/, '')))
    .map(stem);
}

/**
 * The vault entries that share the most words with a question, compared by
 * stem so "running" finds "run" and "runs". At most `limit`, best
 * first; empty when nothing matches.
 */
export function searchVault(question: string, entries: readonly VaultEntry[], limit = 3): VaultEntry[] {
  const wanted = [...new Set(terms(question))];
  if (wanted.length === 0) return [];
  return eligibleEntries(entries)
    .map((entry) => {
      const have = new Set(terms(entry.text));
      const score = wanted.filter((w) => have.has(w)).length;
      return { entry, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || b.entry.createdAt.localeCompare(a.entry.createdAt))
    .slice(0, limit)
    .map((r) => r.entry);
}
