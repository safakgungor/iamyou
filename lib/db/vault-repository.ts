/**
 * The `VaultRepository` data-access interface over the four Vault tables
 * (`profiles`, `vault_entries`, `predictions`, `answers`) and its in-memory
 * implementation.
 *
 * Routes depend on the `VaultRepository` interface; tests inject
 * `InMemoryVaultRepository`; production uses `SupabaseVaultRepository`
 * (added in task 7.3). The in-memory implementation is the one exercised by
 * the P4 property test "delete leaves nothing" (task 7.2).
 *
 * Field names use camelCase at the TypeScript boundary; the SQL columns
 * (snake_case) are mapped by the Supabase implementation.
 */

/** The five vault-entry kinds, aligned with `lib/prediction.ts` and the SQL CHECK. */
export type VaultEntryKind =
  | 'conversation'
  | 'correction'
  | 'story'
  | 'opinion'
  | 'style_example';

/** Family-history options; mirrors the `profiles.family_history` CHECK constraint. */
export type FamilyHistory =
  | 'huntington'
  | 'familial_alzheimers'
  | 'als'
  | 'none'
  | 'prefer_not';

/** Right-not-to-know setting; mirrors the `profiles.rtk_setting` CHECK constraint. */
export type RtkSetting = 'tell_me' | 'doctor_only' | 'record_only';

/**
 * A user's profile row (`profiles` table). `userId` is the owning
 * `auth.uid()` and is the map key in the in-memory implementation rather than
 * a stored field, so it is not part of this shape.
 */
export type Profile = {
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null; // ISO date, e.g. "2008-03-14"
  county: string | null;
  familyHistory: FamilyHistory;
  /** The relative with the family condition, e.g. "father" (care-outputs field 6). */
  familyHistoryRelation?: string | null;
  healthLayerOptIn: boolean;
  rtkSetting: RtkSetting;
  digitalWill: unknown | null; // free-form JSON, shaped by onboarding/demo seed
  synthetic: boolean;
};

/**
 * A vault entry (`vault_entries` table). Aligned with the `VaultEntry` type in
 * `lib/prediction.ts`: `id`, `kind`, `text`, `createdAt`.
 */
export type VaultEntry = {
  id: string;
  kind: VaultEntryKind;
  text: string;
  createdAt: string; // ISO timestamp
};

/** Input for adding a new vault entry; the repository assigns the `id`. */
export type NewVaultEntry = {
  kind: VaultEntryKind;
  text: string;
  createdAt?: string; // defaults to now() when omitted
};

/** A stored prediction (`predictions` table). */
export type Prediction = {
  id: string;
  promptId: string;
  predictedText: string;
  createdAt: string;
};

/** Input for creating a prediction; the repository assigns the `id`. */
export type NewPrediction = {
  promptId: string;
  predictedText: string;
  createdAt?: string;
};

/** A stored, graded answer (`answers` table). */
export type Answer = {
  id: string;
  predictionId: string;
  sessionId: string;
  answerText: string;
  score: number; // already clamped to [0, 1] by the route
  rationale: string | null;
  crisis: boolean;
  createdAt: string;
};

/** Input for creating an answer; the repository assigns the `id`. */
export type NewAnswer = {
  predictionId: string;
  sessionId: string;
  answerText: string;
  score: number;
  rationale?: string | null;
  crisis: boolean;
  createdAt?: string;
};

export interface VaultRepository {
  getProfile(userId: string): Promise<Profile | null>;
  upsertProfile(userId: string, profile: Profile): Promise<void>;

  listVaultEntries(userId: string): Promise<VaultEntry[]>;
  addVaultEntry(userId: string, entry: NewVaultEntry): Promise<VaultEntry>;
  upsertVaultEntry(userId: string, entry: VaultEntry): Promise<void>; // demo seed, idempotent

  createPrediction(userId: string, p: NewPrediction): Promise<Prediction>;
  getPrediction(userId: string, predictionId: string): Promise<Prediction | null>;

  createAnswer(userId: string, a: NewAnswer): Promise<Answer>;
  listAnswers(userId: string): Promise<Answer[]>;
  listSessionAnswers(userId: string, sessionId: string): Promise<Answer[]>;

  /** Removes every row owned by userId across all four tables. (Req 3.5, 3.6 / P4) */
  deleteVault(userId: string): Promise<void>;
}

/**
 * In-memory `VaultRepository` backed by per-`userId` buckets in four maps.
 *
 * `deleteVault(userId)` drops the user's bucket in all four maps while leaving
 * every other user's data untouched — the behaviour verified by property P4.
 */
export class InMemoryVaultRepository implements VaultRepository {
  private readonly profiles = new Map<string, Profile>();
  private readonly vaultEntries = new Map<string, VaultEntry[]>();
  private readonly predictions = new Map<string, Prediction[]>();
  private readonly answers = new Map<string, Answer[]>();

  private counter = 0;

  /** Deterministic, collision-free id generator for the in-memory store. */
  private nextId(prefix: string): string {
    this.counter += 1;
    return `${prefix}_${this.counter}`;
  }

  async getProfile(userId: string): Promise<Profile | null> {
    return this.profiles.get(userId) ?? null;
  }

  async upsertProfile(userId: string, profile: Profile): Promise<void> {
    // Store a copy so callers cannot mutate repository state by reference.
    this.profiles.set(userId, { ...profile });
  }

  async listVaultEntries(userId: string): Promise<VaultEntry[]> {
    return (this.vaultEntries.get(userId) ?? []).map((e) => ({ ...e }));
  }

  async addVaultEntry(userId: string, entry: NewVaultEntry): Promise<VaultEntry> {
    const created: VaultEntry = {
      id: this.nextId('v'),
      kind: entry.kind,
      text: entry.text,
      createdAt: entry.createdAt ?? new Date().toISOString(),
    };
    const bucket = this.vaultEntries.get(userId) ?? [];
    bucket.push(created);
    this.vaultEntries.set(userId, bucket);
    return { ...created };
  }

  async upsertVaultEntry(userId: string, entry: VaultEntry): Promise<void> {
    // Idempotent by id: used by the demo seed with fixed ids v001–v040.
    const bucket = this.vaultEntries.get(userId) ?? [];
    const index = bucket.findIndex((e) => e.id === entry.id);
    if (index >= 0) {
      bucket[index] = { ...entry };
    } else {
      bucket.push({ ...entry });
    }
    this.vaultEntries.set(userId, bucket);
  }

  async createPrediction(userId: string, p: NewPrediction): Promise<Prediction> {
    const created: Prediction = {
      id: this.nextId('p'),
      promptId: p.promptId,
      predictedText: p.predictedText,
      createdAt: p.createdAt ?? new Date().toISOString(),
    };
    const bucket = this.predictions.get(userId) ?? [];
    bucket.push(created);
    this.predictions.set(userId, bucket);
    return { ...created };
  }

  async getPrediction(
    userId: string,
    predictionId: string
  ): Promise<Prediction | null> {
    const bucket = this.predictions.get(userId) ?? [];
    const found = bucket.find((p) => p.id === predictionId);
    return found ? { ...found } : null;
  }

  async createAnswer(userId: string, a: NewAnswer): Promise<Answer> {
    const created: Answer = {
      id: this.nextId('a'),
      predictionId: a.predictionId,
      sessionId: a.sessionId,
      answerText: a.answerText,
      score: a.score,
      rationale: a.rationale ?? null,
      crisis: a.crisis,
      createdAt: a.createdAt ?? new Date().toISOString(),
    };
    const bucket = this.answers.get(userId) ?? [];
    bucket.push(created);
    this.answers.set(userId, bucket);
    return { ...created };
  }

  async listAnswers(userId: string): Promise<Answer[]> {
    return (this.answers.get(userId) ?? []).map((a) => ({ ...a }));
  }

  async listSessionAnswers(userId: string, sessionId: string): Promise<Answer[]> {
    return (this.answers.get(userId) ?? [])
      .filter((a) => a.sessionId === sessionId)
      .map((a) => ({ ...a }));
  }

  /**
   * Removes every row owned by `userId` across all four maps, leaving other
   * users' buckets untouched. (Req 3.5, 3.6 / P4)
   */
  async deleteVault(userId: string): Promise<void> {
    this.profiles.delete(userId);
    this.vaultEntries.delete(userId);
    this.predictions.delete(userId);
    this.answers.delete(userId);
  }
}

// ---------------------------------------------------------------------------
// Supabase implementation
// ---------------------------------------------------------------------------

import type { SupabaseClient } from '@supabase/supabase-js';

/** Shape of a `profiles` row as stored in Postgres (snake_case columns). */
type ProfileRow = {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  date_of_birth: string | null;
  county: string | null;
  family_history: FamilyHistory;
  family_history_relation?: string | null; // migration 0004
  health_layer_opt_in: boolean;
  rtk_setting: RtkSetting;
  digital_will: unknown | null;
  synthetic: boolean;
};

/** Shape of a `vault_entries` row as stored in Postgres. */
type VaultEntryRow = {
  user_id: string;
  id: string;
  kind: VaultEntryKind;
  text: string;
  created_at: string;
};

/** Shape of a `predictions` row as stored in Postgres. */
type PredictionRow = {
  id: string;
  user_id: string;
  prompt_id: string;
  predicted_text: string;
  created_at: string;
};

/** Shape of an `answers` row as stored in Postgres. */
type AnswerRow = {
  id: string;
  user_id: string;
  prediction_id: string;
  session_id: string;
  answer_text: string;
  score: number;
  rationale: string | null;
  crisis: boolean;
  created_at: string;
};

function toProfile(row: ProfileRow): Profile {
  return {
    firstName: row.first_name,
    lastName: row.last_name,
    dateOfBirth: row.date_of_birth,
    county: row.county,
    familyHistory: row.family_history,
    familyHistoryRelation: row.family_history_relation ?? null,
    healthLayerOptIn: row.health_layer_opt_in,
    rtkSetting: row.rtk_setting,
    digitalWill: row.digital_will,
    synthetic: row.synthetic,
  };
}

function toVaultEntry(row: VaultEntryRow): VaultEntry {
  return {
    id: row.id,
    kind: row.kind,
    text: row.text,
    createdAt: row.created_at,
  };
}

function toPrediction(row: PredictionRow): Prediction {
  return {
    id: row.id,
    promptId: row.prompt_id,
    predictedText: row.predicted_text,
    createdAt: row.created_at,
  };
}

function toAnswer(row: AnswerRow): Answer {
  return {
    id: row.id,
    predictionId: row.prediction_id,
    sessionId: row.session_id,
    answerText: row.answer_text,
    score: row.score,
    rationale: row.rationale,
    crisis: row.crisis,
    createdAt: row.created_at,
  };
}

/**
 * Production `VaultRepository` backed by Supabase/Postgres.
 *
 * It runs on an injected `SupabaseClient` — in production the request-scoped
 * `@supabase/ssr` server client from `createSupabaseServerClient`, so every
 * statement executes under the caller's `auth.uid()` and row-level security
 * enforces per-user isolation (Req 3.3, 3.4). Tests and routes may inject any
 * client. Every method additionally filters by `user_id = userId`, and
 * `deleteVault` issues one delete per table. (Req 3.5)
 *
 * The TypeScript boundary is camelCase; the SQL columns are snake_case, mapped
 * by the `to*` helpers above and the explicit object literals below.
 */
export class SupabaseVaultRepository implements VaultRepository {
  constructor(private readonly client: SupabaseClient) {}

  async getProfile(userId: string): Promise<Profile | null> {
    const { data, error } = await this.client
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return data ? toProfile(data as ProfileRow) : null;
  }

  async upsertProfile(userId: string, profile: Profile): Promise<void> {
    const row: ProfileRow = {
      user_id: userId,
      first_name: profile.firstName,
      last_name: profile.lastName,
      date_of_birth: profile.dateOfBirth,
      county: profile.county,
      family_history: profile.familyHistory,
      health_layer_opt_in: profile.healthLayerOptIn,
      rtk_setting: profile.rtkSetting,
      digital_will: profile.digitalWill,
      synthetic: profile.synthetic,
    };
    if (profile.familyHistoryRelation !== undefined) {
      row.family_history_relation = profile.familyHistoryRelation;
    }
    const { error } = await this.client
      .from('profiles')
      .upsert(row, { onConflict: 'user_id' });
    if (!error) return;

    // Before migration 0004 the column does not exist; store the profile
    // without the relation rather than failing the demo seed.
    if (row.family_history_relation !== undefined && error.message?.includes('family_history_relation')) {
      const { family_history_relation: _relation, ...withoutRelation } = row;
      void _relation;
      const retry = await this.client
        .from('profiles')
        .upsert(withoutRelation, { onConflict: 'user_id' });
      if (retry.error) throw retry.error;
      return;
    }
    throw error;
  }

  async listVaultEntries(userId: string): Promise<VaultEntry[]> {
    const { data, error } = await this.client
      .from('vault_entries')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data as VaultEntryRow[]).map(toVaultEntry);
  }

  async addVaultEntry(userId: string, entry: NewVaultEntry): Promise<VaultEntry> {
    const insert: Record<string, unknown> = {
      user_id: userId,
      kind: entry.kind,
      text: entry.text,
    };
    if (entry.createdAt !== undefined) insert.created_at = entry.createdAt;

    const { data, error } = await this.client
      .from('vault_entries')
      .insert(insert)
      .select('*')
      .single();
    if (error) throw error;
    return toVaultEntry(data as VaultEntryRow);
  }

  async upsertVaultEntry(userId: string, entry: VaultEntry): Promise<void> {
    // Idempotent on the composite key (user_id, id): used by the demo seed.
    const row: VaultEntryRow = {
      user_id: userId,
      id: entry.id,
      kind: entry.kind,
      text: entry.text,
      created_at: entry.createdAt,
    };
    const { error } = await this.client
      .from('vault_entries')
      .upsert(row, { onConflict: 'user_id,id' });
    if (error) throw error;
  }

  async createPrediction(userId: string, p: NewPrediction): Promise<Prediction> {
    const insert: Record<string, unknown> = {
      user_id: userId,
      prompt_id: p.promptId,
      predicted_text: p.predictedText,
    };
    if (p.createdAt !== undefined) insert.created_at = p.createdAt;

    const { data, error } = await this.client
      .from('predictions')
      .insert(insert)
      .select('*')
      .single();
    if (error) throw error;
    return toPrediction(data as PredictionRow);
  }

  async getPrediction(
    userId: string,
    predictionId: string
  ): Promise<Prediction | null> {
    const { data, error } = await this.client
      .from('predictions')
      .select('*')
      .eq('user_id', userId)
      .eq('id', predictionId)
      .maybeSingle();
    if (error) throw error;
    return data ? toPrediction(data as PredictionRow) : null;
  }

  async createAnswer(userId: string, a: NewAnswer): Promise<Answer> {
    const insert: Record<string, unknown> = {
      user_id: userId,
      prediction_id: a.predictionId,
      session_id: a.sessionId,
      answer_text: a.answerText,
      score: a.score,
      rationale: a.rationale ?? null,
      crisis: a.crisis,
    };
    if (a.createdAt !== undefined) insert.created_at = a.createdAt;

    const { data, error } = await this.client
      .from('answers')
      .insert(insert)
      .select('*')
      .single();
    if (error) throw error;
    return toAnswer(data as AnswerRow);
  }

  async listAnswers(userId: string): Promise<Answer[]> {
    const { data, error } = await this.client
      .from('answers')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data as AnswerRow[]).map(toAnswer);
  }

  async listSessionAnswers(userId: string, sessionId: string): Promise<Answer[]> {
    const { data, error } = await this.client
      .from('answers')
      .select('*')
      .eq('user_id', userId)
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data as AnswerRow[]).map(toAnswer);
  }

  /**
   * Removes every row owned by `userId` across all four tables, one delete per
   * table, each filtered by `user_id`. (Req 3.5)
   */
  async deleteVault(userId: string): Promise<void> {
    for (const table of ['profiles', 'vault_entries', 'predictions', 'answers']) {
      const { error } = await this.client.from(table).delete().eq('user_id', userId);
      if (error) throw error;
    }
  }
}
