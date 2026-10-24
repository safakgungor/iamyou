/**
 * The pure family-mode logic for care-outputs. No I/O, no model call.
 *
 * A relative named in the profile's `digital_will.family_mode_access` asks how
 * the person would answer a question; the answer must be grounded only in the
 * person's own vault entries. This module decides who may ask, which entries
 * may be sent to Claude, and — after Claude answers — which citations survive.
 * `validateFamilyAnswer` is the target of property test P2 and
 * `selectFamilyEntries` of P4.
 *
 * It imports only types, so screens may import its constants. (Req 10.8)
 */

import type { VaultEntry, VaultEntryKind } from './db/vault-repository';

/** The most vault entries sent to Claude for one family-mode answer. (Req 9.2) */
export const FAMILY_ENTRY_LIMIT = 40;

/** The entry kinds family mode may use; `style_example` is never sent. (Req 9.2) */
export const FAMILY_ENTRY_KINDS: readonly VaultEntryKind[] = [
  'story',
  'opinion',
  'conversation',
  'correction',
] as const;

/** The Claude answer shape, also the route's validated result. (Req 9.5) */
export type FamilyAnswer = { answer: string; cited_entry_ids: string[] };

/**
 * "I don't know how {first_name} would answer that.", with "this person" when
 * there is no first name. (Req 9.4, 10.2)
 */
export function dontKnowAnswer(firstName: string | null): string {
  const name = typeof firstName === 'string' && firstName.trim() !== '' ? firstName.trim() : 'this person';
  return `I don't know how ${name} would answer that.`;
}

/**
 * The relatives named in `digital_will.family_mode_access`, as trimmed,
 * non-empty, deduplicated strings in order; `[]` for any other shape. (Req 9.1)
 */
export function familyModeAccess(digitalWill: unknown): string[] {
  if (typeof digitalWill !== 'object' || digitalWill === null) return [];
  const access = (digitalWill as { family_mode_access?: unknown }).family_mode_access;
  if (!Array.isArray(access)) return [];

  const askers: string[] = [];
  for (const item of access) {
    if (typeof item !== 'string') continue;
    const name = item.trim();
    if (name !== '' && !askers.includes(name)) askers.push(name);
  }
  return askers;
}

/** True only when `asker` exactly equals a name in `familyModeAccess(digitalWill)`. (Req 9.1) */
export function isAllowedAsker(digitalWill: unknown, asker: unknown): boolean {
  return typeof asker === 'string' && familyModeAccess(digitalWill).includes(asker);
}

/**
 * The entries family mode may send: allowed kinds only (never
 * `style_example`), newest `createdAt` first with `id` as tie-break, at most
 * `FAMILY_ENTRY_LIMIT`. Returns copies and never mutates the input. (Req 9.2 / P4)
 */
export function selectFamilyEntries(entries: readonly VaultEntry[]): VaultEntry[] {
  return entries
    .filter((entry) => FAMILY_ENTRY_KINDS.includes(entry.kind))
    .map((entry) => ({ ...entry }))
    .sort((a, b) => {
      if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
      if (a.id !== b.id) return a.id < b.id ? -1 : 1;
      return 0;
    })
    .slice(0, FAMILY_ENTRY_LIMIT);
}

/**
 * Keeps only the cited ids that equal the `id` of a provided entry, in input
 * order, deduplicated, adding none. With none left, returns exactly the
 * Dont_Know_Answer and no citations; otherwise returns the input `answer`
 * unchanged with the surviving ids. Non-array or non-string input fields count
 * as empty. Idempotent, so both `familyAnswer` and the route may apply it.
 * (Req 10.1–10.4 / P2)
 */
export function validateFamilyAnswer(
  answer: FamilyAnswer,
  entries: readonly Pick<VaultEntry, 'id'>[],
  firstName: string | null,
): FamilyAnswer {
  const known = new Set(entries.map((entry) => entry.id));
  const cited: unknown = answer?.cited_entry_ids;

  const kept: string[] = [];
  if (Array.isArray(cited)) {
    for (const id of cited) {
      if (typeof id === 'string' && known.has(id) && !kept.includes(id)) kept.push(id);
    }
  }

  if (kept.length === 0) {
    return { answer: dontKnowAnswer(firstName), cited_entry_ids: [] };
  }

  const text: unknown = answer.answer;
  return { answer: typeof text === 'string' ? text : '', cited_entry_ids: kept };
}
