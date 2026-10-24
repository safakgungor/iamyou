// Feature: twin-loop, Property 4: Delete leaves nothing
//
// Validates: Requirements 3.5, 3.6
//
// Property 4 — Delete leaves nothing: after `deleteVault(userId)` the in-memory
// repository holds zero rows for `userId` across all four tables (profiles,
// vault_entries, predictions, answers); every other user's rows are unchanged.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  InMemoryVaultRepository,
  type FamilyHistory,
  type RtkSetting,
  type Profile,
  type NewVaultEntry,
  type NewPrediction,
  type NewAnswer,
  type VaultEntryKind,
} from "@/lib/db/vault-repository";

const familyHistoryArb: fc.Arbitrary<FamilyHistory> = fc.constantFrom(
  "huntington",
  "familial_alzheimers",
  "als",
  "none",
  "prefer_not",
);

const rtkSettingArb: fc.Arbitrary<RtkSetting> = fc.constantFrom(
  "tell_me",
  "doctor_only",
  "record_only",
);

const vaultEntryKindArb: fc.Arbitrary<VaultEntryKind> = fc.constantFrom(
  "conversation",
  "correction",
  "story",
  "opinion",
  "style_example",
);

const isoTimestampArb: fc.Arbitrary<string> = fc
  .date({
    min: new Date("2020-01-01T00:00:00.000Z"),
    max: new Date("2030-01-01T00:00:00.000Z"),
    noInvalidDate: true,
  })
  .map((d) => d.toISOString());

const profileArb: fc.Arbitrary<Profile> = fc.record({
  firstName: fc.option(fc.string(), { nil: null }),
  lastName: fc.option(fc.string(), { nil: null }),
  dateOfBirth: fc.option(fc.string(), { nil: null }),
  county: fc.option(fc.string(), { nil: null }),
  familyHistory: familyHistoryArb,
  healthLayerOptIn: fc.boolean(),
  rtkSetting: rtkSettingArb,
  digitalWill: fc.option(fc.jsonValue(), { nil: null }),
  synthetic: fc.boolean(),
});

const newVaultEntryArb: fc.Arbitrary<NewVaultEntry> = fc.record(
  {
    kind: vaultEntryKindArb,
    text: fc.string(),
    createdAt: isoTimestampArb,
  },
  { requiredKeys: ["kind", "text"] },
);

const newPredictionArb: fc.Arbitrary<NewPrediction> = fc.record(
  {
    promptId: fc.string({ minLength: 1 }),
    predictedText: fc.string(),
    createdAt: isoTimestampArb,
  },
  { requiredKeys: ["promptId", "predictedText"] },
);

const newAnswerArb: fc.Arbitrary<NewAnswer> = fc.record(
  {
    predictionId: fc.string({ minLength: 1 }),
    sessionId: fc.string({ minLength: 1 }),
    answerText: fc.string(),
    score: fc.double({ min: 0, max: 1, noNaN: true }),
    rationale: fc.option(fc.string(), { nil: null }),
    crisis: fc.boolean(),
    createdAt: isoTimestampArb,
  },
  { requiredKeys: ["predictionId", "sessionId", "answerText", "score", "crisis"] },
);

/** Everything that can be seeded for a single user across the four tables. */
type UserSeed = {
  profile: Profile | null;
  vaultEntries: NewVaultEntry[];
  predictions: NewPrediction[];
  answers: NewAnswer[];
};

const userSeedArb: fc.Arbitrary<UserSeed> = fc.record({
  profile: fc.option(profileArb, { nil: null }),
  vaultEntries: fc.array(newVaultEntryArb, { maxLength: 6 }),
  predictions: fc.array(newPredictionArb, { maxLength: 6 }),
  answers: fc.array(newAnswerArb, { maxLength: 6 }),
});

/**
 * A map of distinct userIds -> their seed. Using `fc.uniqueArray` on keys keeps
 * users distinct so "other users" are genuinely separate buckets. Includes the
 * empty case (no users at all) to cover deleting an absent user.
 */
const userIdArb = fc.string({ minLength: 1, maxLength: 8 });

const seedMapArb: fc.Arbitrary<Map<string, UserSeed>> = fc
  .uniqueArray(fc.tuple(userIdArb, userSeedArb), {
    selector: ([id]) => id,
    maxLength: 5,
  })
  .map((pairs) => new Map(pairs));

/** Snapshot of a user's rows read back through the repository, for comparison. */
async function readUser(repo: InMemoryVaultRepository, userId: string) {
  return {
    profile: await repo.getProfile(userId),
    vaultEntries: await repo.listVaultEntries(userId),
    answers: await repo.listAnswers(userId),
  };
}

describe("Property 4: deleteVault leaves nothing (Requirements 3.5, 3.6)", () => {
  it("removes all of the target user's rows while leaving other users unchanged", async () => {
    await fc.assert(
      fc.asyncProperty(
        seedMapArb,
        // Pick the target by index into the (possibly empty) set of userIds,
        // plus a fallback id that may not exist in the map.
        fc.nat(),
        fc.string({ minLength: 1, maxLength: 8 }),
        async (seeds, targetIndex, fallbackId) => {
          const repo = new InMemoryVaultRepository();

          // Populate the repo for every user across all four tables, capturing
          // the ids the repo assigns so we can later probe getPrediction.
          const createdPredictionIds = new Map<string, string[]>();
          for (const [userId, seed] of seeds) {
            if (seed.profile !== null) {
              await repo.upsertProfile(userId, seed.profile);
            }
            for (const e of seed.vaultEntries) {
              await repo.addVaultEntry(userId, e);
            }
            const predIds: string[] = [];
            for (const p of seed.predictions) {
              const created = await repo.createPrediction(userId, p);
              predIds.push(created.id);
            }
            createdPredictionIds.set(userId, predIds);
            for (const a of seed.answers) {
              await repo.createAnswer(userId, a);
            }
          }

          const userIds = [...seeds.keys()];
          const targetUserId =
            userIds.length > 0 ? userIds[targetIndex % userIds.length] : fallbackId;

          // Snapshot every other user's rows before the delete.
          const otherUserIds = userIds.filter((id) => id !== targetUserId);
          const before = new Map<string, Awaited<ReturnType<typeof readUser>>>();
          for (const id of otherUserIds) {
            before.set(id, await readUser(repo, id));
          }

          // Act.
          await repo.deleteVault(targetUserId);

          // Assert: the target user holds zero rows across all four tables.
          expect(await repo.getProfile(targetUserId)).toBeNull();
          expect(await repo.listVaultEntries(targetUserId)).toEqual([]);
          expect(await repo.listAnswers(targetUserId)).toEqual([]);
          for (const predId of createdPredictionIds.get(targetUserId) ?? []) {
            expect(await repo.getPrediction(targetUserId, predId)).toBeNull();
          }

          // Assert: every other user's rows are exactly unchanged.
          for (const id of otherUserIds) {
            const after = await readUser(repo, id);
            expect(after).toEqual(before.get(id));
            // Predictions for other users remain retrievable by id.
            for (const predId of createdPredictionIds.get(id) ?? []) {
              expect(await repo.getPrediction(id, predId)).not.toBeNull();
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
