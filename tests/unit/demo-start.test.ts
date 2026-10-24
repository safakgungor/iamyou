// Feature: twin-loop, Task 11.2; health-baseline, Task 13.2: unit tests for
// POST /api/demo/start.
//
// These tests exercise the HTTP- and auth-free `seedDemo` helper exported from
// the route against an in-memory VaultRepository and an in-memory
// WeeklyFeatureRepository, so no Supabase, no network, and no Claude call is
// involved. The fixtures come from the route's own `mayaDemoProfile()` /
// `mayaDemoVaultEntries()` / `mayaDemoWeeklyFeatures()` builders, which force
// the demo invariants the seed guarantees.
//
// Covered behaviour:
//   - After seedDemo: the user owns exactly 1 profile with rtk_setting
//     'tell_me' and health_layer_opt_in true, and 40 vault entries v001–v040.
//   - After seedDemo: the caller owns 1,149 weekly feature rows, all
//     `synthetic: true`, whose dates equal `weekly-features.json`, and no other
//     user owns any weekly row.
//   - A second seedDemo call is idempotent — still exactly 1 profile, 40
//     entries and 1,149 weekly rows, with no duplicates (upserts key on
//     user_id, (user_id, id) and (user_id, week_start)).
//   - A repository whose upsert throws (vault or weekly) causes seedDemo to
//     reject; the route maps that to a 500 and presents nothing partial.
//
// Validates: twin-loop Requirements 1.2, 1.6, 1.7; health-baseline 2.7, 2.10
import { describe, expect, it } from "vitest";

import {
  mayaDemoProfile,
  mayaDemoVaultEntries,
  mayaDemoWeeklyFeatures,
  seedDemo,
} from "@/app/api/demo/start/route";
import {
  InMemoryVaultRepository,
  type VaultRepository,
} from "@/lib/db/vault-repository";
import {
  InMemoryWeeklyFeatureRepository,
  type WeeklyFeatureRepository,
} from "@/lib/db/weekly-feature-repository";
import type { WeeklyFeatureRow } from "@/lib/baseline";
import mayaWeeklyFeaturesFile from "@/data/synthetic/maya/weekly-features.json";

const USER_ID = "anon-user-1";
const MAYA_WEEKS = 1149;

/** The 40 ids the Maya seed must produce, v001 … v040. */
function expectedIds(): string[] {
  return Array.from({ length: 40 }, (_, i) => `v${String(i + 1).padStart(3, "0")}`);
}

/** The `week_start` dates straight from `weekly-features.json`, sorted. */
function fileWeekStarts(): string[] {
  return (mayaWeeklyFeaturesFile as Array<{ week_start: string }>)
    .map((r) => r.week_start)
    .sort();
}

/**
 * The real in-memory weekly repository, additionally recording every userId
 * an upsert was issued for, so a test can assert that no user other than the
 * caller received any weekly row.
 */
class RecordingWeeklyFeatureRepository extends InMemoryWeeklyFeatureRepository {
  readonly upsertedUserIds = new Set<string>();

  override async upsertWeeklyFeatures(
    userId: string,
    rows: readonly WeeklyFeatureRow[],
  ): Promise<void> {
    this.upsertedUserIds.add(userId);
    await super.upsertWeeklyFeatures(userId, rows);
  }
}

/** Runs one full Maya seed for `userId` against the given repositories. */
function seedMaya(
  repo: VaultRepository,
  weeklyRepo: WeeklyFeatureRepository,
  userId: string = USER_ID,
): Promise<void> {
  return seedDemo(
    repo,
    weeklyRepo,
    userId,
    mayaDemoProfile(),
    mayaDemoVaultEntries(),
    mayaDemoWeeklyFeatures(),
  );
}

describe("seedDemo (POST /api/demo/start)", () => {
  it("seeds exactly 1 profile with Maya's invariants and 40 vault entries v001–v040", async () => {
    const repo = new InMemoryVaultRepository();
    const weeklyRepo = new InMemoryWeeklyFeatureRepository();

    await seedMaya(repo, weeklyRepo);

    // Exactly one profile, carrying the forced demo invariants (Req 1.2, 1.7).
    const profile = await repo.getProfile(USER_ID);
    expect(profile).not.toBeNull();
    expect(profile?.rtkSetting).toBe("tell_me");
    expect(profile?.healthLayerOptIn).toBe(true);
    expect(profile?.synthetic).toBe(true);
    // care-outputs 4.2: the relation for the summary's family-history field.
    expect(profile?.familyHistoryRelation).toBe("father");

    // Exactly 40 vault entries with ids v001–v040 (Req 1.2).
    const entries = await repo.listVaultEntries(USER_ID);
    expect(entries).toHaveLength(40);
    expect(entries.map((e) => e.id).sort()).toEqual(expectedIds());
  });

  it("seeds 1,149 synthetic weekly rows owned only by the caller, dated as in the file (Req 2.7)", async () => {
    const repo = new InMemoryVaultRepository();
    const weeklyRepo = new RecordingWeeklyFeatureRepository();

    await seedMaya(repo, weeklyRepo);

    const rows = await weeklyRepo.listWeeklyFeatures(USER_ID);
    expect(rows).toHaveLength(MAYA_WEEKS);
    expect(rows.every((r) => r.synthetic === true)).toBe(true);
    expect(rows.map((r) => r.weekStart)).toEqual(fileWeekStarts());

    // No other user owns any weekly row: the only upsert target was the caller.
    expect([...weeklyRepo.upsertedUserIds]).toEqual([USER_ID]);
    expect(await weeklyRepo.listWeeklyFeatures("someone-else")).toHaveLength(0);
  });

  it("is idempotent — a second seedDemo leaves exactly 1 profile, 40 entries and 1,149 weekly rows", async () => {
    const repo = new InMemoryVaultRepository();
    const weeklyRepo = new InMemoryWeeklyFeatureRepository();

    await seedMaya(repo, weeklyRepo);
    await seedMaya(repo, weeklyRepo);

    // Still a single profile.
    const profile = await repo.getProfile(USER_ID);
    expect(profile).not.toBeNull();
    expect(profile?.rtkSetting).toBe("tell_me");
    expect(profile?.healthLayerOptIn).toBe(true);

    // Still exactly 40 entries, each id present exactly once (Req 1.2).
    const entries = await repo.listVaultEntries(USER_ID);
    expect(entries).toHaveLength(40);
    const ids = entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(40);
    expect([...ids].sort()).toEqual(expectedIds());

    // Still exactly 1,149 weekly rows, each week present once (Req 2.10).
    const rows = await weeklyRepo.listWeeklyFeatures(USER_ID);
    expect(rows).toHaveLength(MAYA_WEEKS);
    expect(new Set(rows.map((r) => r.weekStart)).size).toBe(MAYA_WEEKS);
  });

  it("rejects when a repository upsert throws, committing nothing partial (Req 1.6, 1.7)", async () => {
    // A repo whose vault-entry upsert always fails. Subclassing the in-memory
    // repo keeps every other method intact (so listVaultEntries observes real
    // committed state) while forcing the vault upsert to throw. The profile
    // upsert runs first and really lands, so we can confirm no vault entry was
    // committed before the throw.
    class ThrowingVaultRepository extends InMemoryVaultRepository {
      override async upsertVaultEntry(): Promise<void> {
        throw new Error("simulated vault upsert failure");
      }
    }
    const throwingRepo: VaultRepository = new ThrowingVaultRepository();
    const weeklyRepo = new InMemoryWeeklyFeatureRepository();

    await expect(seedMaya(throwingRepo, weeklyRepo)).rejects.toThrow(
      "simulated vault upsert failure",
    );

    // seedDemo threw on the first vault-entry upsert, so no entries landed —
    // the route turns this rejection into a 500 and presents nothing partial.
    const entries = await throwingRepo.listVaultEntries(USER_ID);
    expect(entries).toHaveLength(0);
    // The weekly upsert runs after the vault entries, so none landed either.
    expect(await weeklyRepo.listWeeklyFeatures(USER_ID)).toHaveLength(0);
    // The profile upsert ran before the throw; the route's 500 heals on retry
    // because every upsert is idempotent.
    const profile = await throwingRepo.getProfile(USER_ID);
    expect(profile).not.toBeNull();
  });

  it("rejects when the weekly-features upsert throws (route → 500; Req 2.10)", async () => {
    class ThrowingWeeklyFeatureRepository extends InMemoryWeeklyFeatureRepository {
      override async upsertWeeklyFeatures(): Promise<void> {
        throw new Error("simulated weekly upsert failure");
      }
    }
    const repo = new InMemoryVaultRepository();
    const throwingWeeklyRepo: WeeklyFeatureRepository =
      new ThrowingWeeklyFeatureRepository();

    await expect(seedMaya(repo, throwingWeeklyRepo)).rejects.toThrow(
      "simulated weekly upsert failure",
    );
    expect(await throwingWeeklyRepo.listWeeklyFeatures(USER_ID)).toHaveLength(0);
  });
});
