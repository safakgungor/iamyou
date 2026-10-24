/**
 * The `DraftRepository` data-access interface over the `drafts` table and its
 * in-memory implementation.
 *
 * Routes depend on the `DraftRepository` interface; tests inject
 * `InMemoryDraftRepository`; production uses `SupabaseDraftRepository`
 * (added in task 4.3). The in-memory implementation is the one exercised by
 * the route unit tests and the extended "delete leaves nothing" property P4.
 *
 * Field names use camelCase at the TypeScript boundary; the SQL columns
 * (snake_case) are mapped by the Supabase implementation.
 */

import type { DraftState } from '../drafts';

/**
 * A stored Draft (`drafts` table). `userId` is the owning `auth.uid()` and is
 * the map key in the in-memory implementation rather than a stored field, so
 * it is not part of this shape. `sentAt` is null until the Draft is sent.
 * (Req 4, 5.3)
 */
export type Draft = {
  id: string;
  inboxMessageId: string; // the Inbox_Message this Draft replies to
  body: string; // the draft text
  state: DraftState;
  sentAt: string | null; // ISO timestamp, null unless state === 'sent' (Req 5.3)
  createdAt: string;
};

/** Input for creating a Draft; the repository assigns the `id`. State starts at 'draft'. */
export type NewDraft = {
  inboxMessageId: string;
  body: string;
};

/**
 * A patch applied by the transition route: the new state and sent_at, plus an
 * optional new `body` for the edit path. When `body` is present it replaces the
 * stored draft text (used by `edit` with a user-supplied body); when it is
 * omitted the stored body is left unchanged. (Req 4.6, 4.11, 6.3)
 */
export type DraftPatch = {
  state: DraftState;
  sentAt: string | null;
  body?: string;
};

export interface DraftRepository {
  /** Creates a Draft in the `draft` state with `sent_at` null. (Req 3.5, 5.3) */
  createDraft(userId: string, draft: NewDraft): Promise<Draft>;

  /** Loads a Draft owned by the caller, or null. */
  getDraft(userId: string, draftId: string): Promise<Draft | null>;

  /**
   * Applies the new state, sent_at, and — when `patch.body` is present — the new
   * body to the caller's Draft; returns the updated row. The edit path threads
   * the user's edited text through `patch.body`; when `patch.body` is omitted
   * the stored body is left unchanged. (Req 4.6, 4.11, 6.3)
   */
  updateDraft(userId: string, draftId: string, patch: DraftPatch): Promise<Draft>;

  /** Removes the caller's Draft row entirely. Used by the discard path. (Req 6.6) */
  deleteDraft(userId: string, draftId: string): Promise<void>;

  /**
   * Removes EVERY Draft owned by the caller. Used by the "delete my vault" path
   * so that clearing a user's vault also clears their drafts (twin-loop
   * property P4, extended here). (Req 6.6)
   */
  deleteAllDrafts(userId: string): Promise<void>;
}

/**
 * In-memory `DraftRepository` backed by per-`userId` buckets in a single map.
 *
 * Every method returns copies so callers cannot mutate stored rows by
 * reference. `deleteAllDrafts(userId)` empties that user's entry in the map
 * while leaving every other user's drafts untouched — the behaviour verified
 * by the extended property P4.
 */
export class InMemoryDraftRepository implements DraftRepository {
  private readonly drafts = new Map<string, Draft[]>();

  private counter = 0;

  /** Deterministic, collision-free id generator for the in-memory store. */
  private nextId(prefix: string): string {
    this.counter += 1;
    return `${prefix}_${this.counter}`;
  }

  async createDraft(userId: string, draft: NewDraft): Promise<Draft> {
    const created: Draft = {
      id: this.nextId('d'),
      inboxMessageId: draft.inboxMessageId,
      body: draft.body,
      state: 'draft',
      sentAt: null,
      createdAt: new Date().toISOString(),
    };
    const bucket = this.drafts.get(userId) ?? [];
    bucket.push(created);
    this.drafts.set(userId, bucket);
    return { ...created };
  }

  async getDraft(userId: string, draftId: string): Promise<Draft | null> {
    const bucket = this.drafts.get(userId) ?? [];
    const found = bucket.find((d) => d.id === draftId);
    return found ? { ...found } : null;
  }

  async updateDraft(
    userId: string,
    draftId: string,
    patch: DraftPatch
  ): Promise<Draft> {
    const bucket = this.drafts.get(userId) ?? [];
    const index = bucket.findIndex((d) => d.id === draftId);
    if (index < 0) {
      throw new Error(`Draft ${draftId} not found for user ${userId}`);
    }
    const existing = bucket[index];
    const updated: Draft = {
      ...existing,
      state: patch.state,
      sentAt: patch.sentAt,
      // Write the new body only when the patch carries one; otherwise leave the
      // stored body unchanged. (Req 4.6, 4.11, 6.3)
      body: patch.body !== undefined ? patch.body : existing.body,
    };
    bucket[index] = updated;
    this.drafts.set(userId, bucket);
    return { ...updated };
  }

  async deleteDraft(userId: string, draftId: string): Promise<void> {
    const bucket = this.drafts.get(userId) ?? [];
    const next = bucket.filter((d) => d.id !== draftId);
    this.drafts.set(userId, next);
  }

  /**
   * Removes every Draft owned by `userId`, leaving other users' buckets
   * untouched. (Req 6.6 / P4)
   */
  async deleteAllDrafts(userId: string): Promise<void> {
    this.drafts.delete(userId);
  }
}

// ---------------------------------------------------------------------------
// Supabase implementation
// ---------------------------------------------------------------------------

import type { SupabaseClient } from '@supabase/supabase-js';

/** Shape of a `drafts` row as stored in Postgres (snake_case columns). */
type DraftRow = {
  id: string;
  user_id: string;
  inbox_message_id: string;
  body: string;
  state: DraftState;
  sent_at: string | null;
  created_at: string;
};

function toDraft(row: DraftRow): Draft {
  return {
    id: row.id,
    inboxMessageId: row.inbox_message_id,
    body: row.body,
    state: row.state,
    sentAt: row.sent_at,
    createdAt: row.created_at,
  };
}

/**
 * Production `DraftRepository` backed by Supabase/Postgres.
 *
 * It runs on an injected `SupabaseClient` — in production the request-scoped
 * `@supabase/ssr` server client from `createSupabaseServerClient`, so every
 * statement executes under the caller's `auth.uid()` and row-level security
 * enforces per-user isolation. Every method additionally filters by
 * `user_id = userId`, and `deleteAllDrafts` issues a single delete over the
 * `drafts` table. (Req 3.5, 6.6)
 *
 * The TypeScript boundary is camelCase; the SQL columns are snake_case, mapped
 * by `toDraft` above and the explicit object literals below.
 */
export class SupabaseDraftRepository implements DraftRepository {
  constructor(private readonly client: SupabaseClient) {}

  async createDraft(userId: string, draft: NewDraft): Promise<Draft> {
    const insert = {
      user_id: userId,
      inbox_message_id: draft.inboxMessageId,
      body: draft.body,
      state: 'draft' as DraftState,
      sent_at: null,
    };
    const { data, error } = await this.client
      .from('drafts')
      .insert(insert)
      .select('*')
      .single();
    if (error) throw error;
    return toDraft(data as DraftRow);
  }

  async getDraft(userId: string, draftId: string): Promise<Draft | null> {
    const { data, error } = await this.client
      .from('drafts')
      .select('*')
      .eq('user_id', userId)
      .eq('id', draftId)
      .maybeSingle();
    if (error) throw error;
    return data ? toDraft(data as DraftRow) : null;
  }

  async updateDraft(
    userId: string,
    draftId: string,
    patch: DraftPatch
  ): Promise<Draft> {
    // Always write state and sent_at; write the body column only when the patch
    // carries one, leaving the stored body unchanged otherwise. (Req 4.6, 4.11, 6.3)
    const update: Record<string, unknown> = {
      state: patch.state,
      sent_at: patch.sentAt,
    };
    if (patch.body !== undefined) update.body = patch.body;

    const { data, error } = await this.client
      .from('drafts')
      .update(update)
      .eq('user_id', userId)
      .eq('id', draftId)
      .select('*')
      .single();
    if (error) throw error;
    return toDraft(data as DraftRow);
  }

  async deleteDraft(userId: string, draftId: string): Promise<void> {
    const { error } = await this.client
      .from('drafts')
      .delete()
      .eq('user_id', userId)
      .eq('id', draftId);
    if (error) throw error;
  }

  /**
   * Removes every Draft owned by `userId` with a single delete filtered by
   * `user_id`, leaving other users' drafts untouched. (Req 6.6 / P4)
   */
  async deleteAllDrafts(userId: string): Promise<void> {
    const { error } = await this.client
      .from('drafts')
      .delete()
      .eq('user_id', userId);
    if (error) throw error;
  }
}
