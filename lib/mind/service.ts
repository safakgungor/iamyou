/**
 * The testable cores of `GET /api/mind` and `POST /api/mind/ask`. The route
 * handlers only authenticate the caller and wire the production collaborators;
 * every decision is made here, against a `VaultRepository` and a `MindClaude`
 * passed in, so tests run on `InMemoryVaultRepository` with Claude mocked.
 *
 * How the tree stays fast and keeps growing:
 *
 *  1. The vault is fingerprinted (`vaultVersion`). A Claude-grown tree for the
 *     caller's current version is served from the in-memory cache.
 *  2. Maya's seeded vault ships a pre-grown tree (`maya-tree.json`), so the
 *     demo opens instantly; it is reused only for entries whose text still
 *     matches, and only ever as a proposal that `sanitizeTree` re-checks.
 *  3. Otherwise the caller gets a provisional tree at once — the last grown
 *     tree with new entries placed by keyword (`mixed`), or a keyword-only
 *     tree — with `pending: true`, while Claude regrows it in the background.
 *     The page polls until `pending` is false.
 *  4. If Claude fails, the keyword tree stands (`pending: false`) and the call
 *     is not retried for a while.
 */

import { COUNSELOR_MESSAGE, SUPPORT_MESSAGE } from '../safety';
import type { VaultRepository } from '../db/vault-repository';
import {
  fallbackTree,
  hashString,
  learnedCount,
  sanitizeTree,
  searchVault,
  treeAsProposal,
  vaultVersion,
} from './fallback';
import mayaTree from './maya-tree.json';
import {
  asksForHealthReading,
  HEALTH_MESSAGE,
  isCrisis,
  isGeneticsQuestion,
  soundsLikeDiagnosis,
} from './safety';
import {
  ClaudeTreeSchema,
  MindAskResponseSchema,
  MindResponseSchema,
  type ClaudeTree,
  type MindAskResponse,
  type MindResponse,
} from './schemas';
import {
  eligibleEntries,
  toMindSource,
  type MindClaude,
  type MindTree,
  type MindTreeSource,
} from './types';

/* -------------------------------------------------------------------------- */
/* Cache                                                                      */
/* -------------------------------------------------------------------------- */

/** After a failed grouping, serve the keyword tree for this long before retrying. */
const RETRY_AFTER_MS = 2 * 60_000;

/** Grown trees kept in memory; the oldest is dropped beyond this. */
const MAX_CACHED_TREES = 500;

export type MindCache = {
  /** userId → the latest Claude-grown tree and the vault version it was grown for. */
  trees: Map<string, { version: string; tree: MindTree }>;
  /** userId → the vault version the caller last asked for. */
  latest: Map<string, string>;
  /** `${userId}:${version}` → the running grouping job. */
  jobs: Map<string, Promise<MindTree | null>>;
  /** `${userId}:${version}` → when the grouping last failed. */
  failures: Map<string, number>;
};

export function createMindCache(): MindCache {
  return { trees: new Map(), latest: new Map(), jobs: new Map(), failures: new Map() };
}

/** One cache per server process, kept on `globalThis` so dev reloads keep it. */
export function sharedMindCache(): MindCache {
  const g = globalThis as { __iamyouMindCache?: MindCache };
  g.__iamyouMindCache ??= createMindCache();
  return g.__iamyouMindCache;
}

/* -------------------------------------------------------------------------- */
/* Pre-grown trees                                                            */
/* -------------------------------------------------------------------------- */

/** A tree grown ahead of time, with a hash of each entry text it was grown from. */
export type KnownTree = { entries: Record<string, string>; tree: ClaudeTree };

export const KNOWN_TREES: KnownTree[] = [
  { entries: mayaTree.entries as Record<string, string>, tree: ClaudeTreeSchema.parse(mayaTree.tree) },
];

/**
 * The known tree restricted to entries whose text is unchanged, and whether it
 * covers this vault exactly. `null` when no known tree shares an entry.
 */
function knownProposal(
  entries: ReturnType<typeof eligibleEntries>,
  known: readonly KnownTree[],
): { proposal: ClaudeTree; complete: boolean } | null {
  for (const k of known) {
    const valid = new Set(entries.filter((e) => k.entries[e.id] === hashString(e.text)).map((e) => e.id));
    if (valid.size === 0) continue;
    return {
      proposal: {
        branches: k.tree.branches.map((b) => ({
          branch: b.branch,
          nodes: b.nodes.map((n) => ({ ...n, entry_ids: n.entry_ids.filter((id) => valid.has(id)) })),
        })),
      },
      complete: valid.size === entries.length && valid.size === Object.keys(k.entries).length,
    };
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* GET /api/mind                                                              */
/* -------------------------------------------------------------------------- */

export type MindDeps = {
  repo: VaultRepository;
  claude: MindClaude;
  cache: MindCache;
  /** Pre-grown trees; defaults to Maya's. */
  known?: readonly KnownTree[];
  /** How long to wait for a running grouping before answering provisionally. */
  waitMs?: number;
  /** Keeps a background job alive after the response (the route passes `after`). */
  schedule?: (job: Promise<unknown>) => void;
  now?: () => number;
};

/** Resolves with the job's result, or `undefined` if it is still running after `ms`. */
async function settleWithin<T>(job: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
  });
  try {
    return await Promise.race([job, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function remember(cache: MindCache, userId: string, version: string, tree: MindTree): void {
  cache.trees.delete(userId);
  cache.trees.set(userId, { version, tree });
  if (cache.trees.size > MAX_CACHED_TREES) {
    const oldest = cache.trees.keys().next().value;
    if (oldest !== undefined) cache.trees.delete(oldest);
  }
}

/** The mind tree for `userId`. Never throws for a Claude failure. */
export async function getMind(deps: MindDeps, userId: string): Promise<MindResponse> {
  const { repo, claude, cache } = deps;
  const now = deps.now ?? Date.now;

  const [entries, profile] = await Promise.all([repo.listVaultEntries(userId), repo.getProfile(userId)]);
  const eligible = eligibleEntries(entries);
  const version = vaultVersion(entries);
  cache.latest.set(userId, version);

  const respond = (tree: MindTree, source: MindTreeSource, pending: boolean): MindResponse =>
    MindResponseSchema.parse({
      name: profile?.firstName?.trim() || 'You',
      version,
      learned: learnedCount(tree),
      source,
      pending,
      tree,
      entries: eligible.map(toMindSource),
    });

  if (eligible.length === 0) return respond(fallbackTree([]), 'keywords', false);

  const cached = cache.trees.get(userId);
  if (cached?.version === version) return respond(cached.tree, 'model', false);

  const known = knownProposal(eligible, deps.known ?? KNOWN_TREES);
  if (known?.complete) {
    const tree = sanitizeTree(known.proposal, entries);
    remember(cache, userId, version, tree);
    return respond(tree, 'model', false);
  }

  // Grow from what the twin already knew: the last grown tree, else the
  // pre-grown one. New entries are placed by keyword until Claude regrows.
  const base = cached ? treeAsProposal(cached.tree) : (known?.proposal ?? null);
  const provisional = sanitizeTree(base, entries);
  const provisionalSource: MindTreeSource = base ? 'mixed' : 'keywords';

  const key = `${userId}:${version}`;
  const failedAt = cache.failures.get(key);
  if (failedAt !== undefined && now() - failedAt < RETRY_AFTER_MS) {
    return respond(provisional, provisionalSource, false);
  }

  let job = cache.jobs.get(key);
  if (!job) {
    job = Promise.resolve()
      .then(() => claude.groupEntries(eligible))
      .then((proposal) => {
        if (!proposal) {
          cache.failures.set(key, now());
          return null;
        }
        const tree = sanitizeTree(proposal, entries);
        // A slower job for an older version must not replace a newer tree.
        if (cache.latest.get(userId) === version) remember(cache, userId, version, tree);
        cache.failures.delete(key);
        return tree;
      })
      .catch(() => {
        cache.failures.set(key, now());
        return null;
      })
      .finally(() => {
        cache.jobs.delete(key);
      });
    cache.jobs.set(key, job);
    deps.schedule?.(job);
  }

  const grown = await settleWithin(job, deps.waitMs ?? 0);
  if (grown) return respond(grown, 'model', false);
  return respond(provisional, provisionalSource, grown === undefined);
}

/* -------------------------------------------------------------------------- */
/* POST /api/mind/ask                                                         */
/* -------------------------------------------------------------------------- */

export const EMPTY_VAULT_ANSWER = "Your vault is empty so far. Do a check-in and I'll start learning.";
export const NOTHING_FOUND_ANSWER = "You haven't told me about that yet.";
export const QUOTE_LEAD = "Here's what you told me.";

/** At most this many entries are quoted under an answer. */
const MAX_SOURCES = 4;
const MAX_ANSWER_CHARS = 420;

export type AskDeps = { repo: VaultRepository; claude: MindClaude };

/**
 * Answers a question about the caller from their own vault only, quoting the
 * entries used. Crisis, genetic-testing and health-reading questions get the
 * fixed safety messages, both before and after Claude.
 */
export async function askMind(deps: AskDeps, userId: string, question: string): Promise<MindAskResponse> {
  const q = question.trim();
  const reply = (body: MindAskResponse) => MindAskResponseSchema.parse(body);
  const fixed = (kind: 'support' | 'counselor' | 'health', source: 'rules' | 'model') =>
    reply({
      kind,
      answer: { support: SUPPORT_MESSAGE, counselor: COUNSELOR_MESSAGE, health: HEALTH_MESSAGE }[kind],
      sources: [],
      source,
    });

  if (isCrisis(q)) return fixed('support', 'rules');
  if (isGeneticsQuestion(q)) return fixed('counselor', 'rules');
  if (asksForHealthReading(q)) return fixed('health', 'rules');

  const entries = eligibleEntries(await deps.repo.listVaultEntries(userId));
  if (entries.length === 0) {
    return reply({ kind: 'empty', answer: EMPTY_VAULT_ANSWER, sources: [], source: 'rules' });
  }

  const byId = new Map(entries.map((e) => [e.id, e]));
  const raw = await deps.claude.answerFromVault(q, entries);

  if (!raw) {
    const matches = searchVault(q, entries, MAX_SOURCES - 1);
    return matches.length === 0
      ? reply({ kind: 'empty', answer: NOTHING_FOUND_ANSWER, sources: [], source: 'keywords' })
      : reply({ kind: 'answer', answer: QUOTE_LEAD, sources: matches.map(toMindSource), source: 'keywords' });
  }

  if (raw.status === 'crisis') return fixed('support', 'model');
  if (raw.status === 'genetics') return fixed('counselor', 'model');
  if (raw.status === 'health') return fixed('health', 'model');

  const sources = [...new Set(raw.entry_ids)]
    .filter((id) => byId.has(id))
    .slice(0, MAX_SOURCES)
    .map((id) => toMindSource(byId.get(id)!));

  if (raw.status === 'not_in_vault' || sources.length === 0) {
    return reply({ kind: 'empty', answer: NOTHING_FOUND_ANSWER, sources: [], source: 'model' });
  }

  const text = raw.answer.replace(/\s+/g, ' ').trim();
  const safe = text.length > 0 && text.length <= MAX_ANSWER_CHARS && !soundsLikeDiagnosis(text) && !isCrisis(text);
  return reply({ kind: 'answer', answer: safe ? text : QUOTE_LEAD, sources, source: 'model' });
}
