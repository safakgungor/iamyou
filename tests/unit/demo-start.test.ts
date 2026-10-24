// Feature: twin-loop, Task 11.2: unit tests for POST /api/demo/start.
//
// These tests exercise the HTTP- and auth-free `seedDemo` helper exported from
// the route against an in-memory VaultRepository, so no Supabase, no network,
// and no Claude call is involved. The fixtures come from the route's own
// `mayaDemoProfile()` / `mayaDemoVaultEntries()` builders, which force the demo
// invariants the seed guarantees.
//
// Covered behaviour:
//   - After seedDemo: the user owns exactly 1 profile with rtk_setting
//     'tell_me' and health_layer_opt_in true, and 40 vault entries v001–v040.
//   - A second seedDemo call is idempotent — still exactly 1 profile and 40
//     entries, with no duplicates (upserts key on user_id and (user_id, id)).
//   - A repository whose upsert throws causes seedDemo to reject; the route
//     maps that to a 500 and presents nothing partial.
//
// Validates: Requirements 1.2, 1.6, 1.7
import { describe, expect, it } from "vitest";

import {
  mayaDemoProfile,
  mayaDemoVaultEntries,
  seedDemo,
} from "@/app/api/demo/start/route";
import {
  InMemoryVaultRepository,
  type VaultRepository,
} from "@/lib/db/vault-repository";

const USER_ID = "anon-user-1";

/** The 40 ids the Maya seed must produce, v001 … v040. */
function expectedIds(): string[] {
  return Array.from({ length: 40 }, (_, i) => `v${String(i + 1).padStart(3, "0")}`);
}

describe("seedDemo (POST /api/demo/start)", () => {
  it("seeds exactly 1 profile with Maya's invariants and 40 vault entries v001–v040", async () => {
    const repo = new InMemoryVaultRepository();

    await seedDemo(repo, USER_ID, mayaDemoProfile(), mayaDemoVaultEntries());

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

  it("is idempotent — a second seedDemo leaves exactly 1 profile and 40 entries, no duplicates", async () => {
    const repo = new InMemoryVaultRepository();

    await seedDemo(repo, USER_ID, mayaDemoProfile(), mayaDemoVaultEntries());
    await seedDemo(repo, USER_ID, mayaDemoProfile(), mayaDemoVaultEntries());

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

    await expect(
      seedDemo(throwingRepo, USER_ID, mayaDemoProfile(), mayaDemoVaultEntries()),
    ).rejects.toThrow("simulated vault upsert failure");

    // seedDemo threw on the first vault-entry upsert, so no entries landed —
    // the route turns this rejection into a 500 and presents nothing partial.
    const entries = await throwingRepo.listVaultEntries(USER_ID);
    expect(entries).toHaveLength(0);
    // The profile upsert ran before the throw; the route's 500 heals on retry
    // because every upsert is idempotent.
    const profile = await throwingRepo.getProfile(USER_ID);
    expect(profile).not.toBeNull();
  });
});
