/**
 * Shared types and constants for the mind tree: a mind map of everything the
 * twin has learned, grown from the caller's vault entries.
 *
 * Client-safe: no I/O, no SDK. The page, the routes and the tests all read the
 * branch list from here, so the five branches keep one fixed order everywhere.
 */

import type { VaultEntry, VaultEntryKind } from '../db/vault-repository';
import type { ClaudeAnswer, ClaudeTree } from './schemas';

/** The five fixed branches, in the order they grow around the centre node. */
export const BRANCHES = [
  { id: 'family', label: 'Family & friends', short: 'Family' },
  { id: 'body', label: 'Hobbies & body', short: 'Body' },
  { id: 'mind', label: 'Study & mind', short: 'Mind' },
  { id: 'work', label: 'Work & career', short: 'Work' },
  { id: 'values', label: 'Values & character', short: 'Values' },
] as const;

export type BranchId = (typeof BRANCHES)[number]['id'];

export const BRANCH_IDS = BRANCHES.map((b) => b.id) as [BranchId, ...BranchId[]];

/** The entry kinds the tree is grown from. `style_example` is tone, not fact. */
export type MindEntryKind = Exclude<VaultEntryKind, 'style_example'>;

/** One short thing the twin learned, with the entries it came from. */
export type MindNode = {
  id: string;
  label: string; // 2–5 words
  fact: string; // one line
  entry_ids: string[]; // never empty, every id exists in the caller's vault
};

export type MindBranch = {
  id: BranchId;
  label: string;
  nodes: MindNode[];
};

/** Always exactly the five branches, in `BRANCHES` order. */
export type MindTree = {
  branches: MindBranch[];
};

/** A vault entry as the page shows it under a node or an answer. */
export type MindSource = {
  id: string;
  kind: MindEntryKind;
  created_at: string;
  text: string;
};

/**
 * Who grew the tree: `model` is Claude's grouping, `keywords` the
 * deterministic fallback, `mixed` a model tree with the newest entries placed
 * by keyword while Claude regrows it.
 */
export type MindTreeSource = 'model' | 'mixed' | 'keywords';

/**
 * The two Claude calls the mind service needs. Production wires the
 * server-only `lib/mind/claude.ts`; tests pass a mock. Both resolve to `null`
 * when the call fails, so the caller can fall back to keywords.
 */
export interface MindClaude {
  groupEntries(entries: readonly VaultEntry[]): Promise<ClaudeTree | null>;
  answerFromVault(question: string, entries: readonly VaultEntry[]): Promise<ClaudeAnswer | null>;
}

/** The check-in correction route prefixes each stored correction with this marker. */
const CORRECTION_MARKER = /^\[correction:[^\]]*\]\s*/;

/**
 * Entries the tree and the answers may use: everything but style examples,
 * with the correction route's internal marker taken off the text.
 */
export function eligibleEntries(entries: readonly VaultEntry[]): VaultEntry[] {
  return entries
    .filter((e) => e.kind !== 'style_example')
    .map((e) => (CORRECTION_MARKER.test(e.text) ? { ...e, text: e.text.replace(CORRECTION_MARKER, '') } : e));
}

export function toMindSource(entry: VaultEntry): MindSource {
  return {
    id: entry.id,
    kind: entry.kind as MindEntryKind,
    created_at: entry.createdAt,
    text: entry.text,
  };
}
