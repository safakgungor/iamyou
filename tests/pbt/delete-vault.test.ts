// Feature: twin-loop, Property 4: Delete leaves nothing (extended for drafts)
//
// Validates: Requirements 3.5, 3.6, 6.6
//
// Property 4 — Delete leaves nothing: after `deleteVaultForUser(vaultRepo,
// draftRepo, userId)` the in-memory repositories hold zero rows for `userId`
// across all four vault tables (profiles, vault_entries, predictions, answers)
// AND zero drafts; every other user's vault rows and drafts are unchanged.
//
// The extension (task 13, Req 6.6) seeds an `InMemoryDraftRepository` alongside
// the vault repo and asserts that clearing a user's vault via
// `deleteVaultForUser` also clears that user's drafts (`deleteAllDrafts` was
// called) while every other user's drafts survive.

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
import {
  InMemoryDraftRepository,
  type NewDraft,
} from "@/lib/db/draft-repository";
import { deleteVaultForUser } from "@/app/api/vault/route";

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

const newDraftArb: fc.Arbitrary<NewDraft> = fc.record({
  inboxMessageId: fc.string({ minLength: 1 }),
  body: fc.string(),
});

/**
 * Everything that can be seeded for a single user across the four vault tables
 * plus the drafts table.
 */
type UserSeed = {
  profile: Profile | null;
  vaultEntries: NewVaultEntry[];
  predictions: NewPrediction[];
  answers: NewAnswer[];
  drafts: NewDraft[];
};

const userSeedArb: fc.Arbitrary<UserSeed> = fc.record({
  profile: fc.option(profileArb, { nil: null }),
  vaultEntries: fc.array(newVaultEntryArb, { maxLength: 6 }),
  predictions: fc.array(newPredictionArb, { maxLength: 6 }),
  answers: fc.array(newAnswerArb, { maxLength: 6 }),
  drafts: fc.array(newDraftArb, { maxLength: 6 }),
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

/** Snapshot of a user's rows read back through the repositories, for comparison. */
async function readUser(
  repo: InMemoryVaultRepository,
  draftRepo: InMemoryDraftRepository,
  userId: string,
  draftIds: string[],
) {
  const drafts = [];
  for (const id of draftIds) {
    drafts.push(await draftRepo.getDraft(userId, id));
  }
  return {
    profile: await repo.getProfile(userId),
    vaultEntries: await repo.listVaultEntries(userId),
    answers: await repo.listAnswers(userId),
    drafts,
  };
}

describe("Property 4: deleteVaultForUser leaves nothing — including drafts (Requirements 3.5, 3.6, 6.6)", () => {
  it("removes all of the target user's vault rows and drafts while leaving other users unchanged", async () => {
    await fc.assert(
      fc.asyncProperty(
        seedMapArb,
        // Pick the target by index into the (possibly empty) set of userIds,
        // plus a fallback id that may not exist in the map.
        fc.nat(),
        fc.string({ minLength: 1, maxLength: 8 }),
        async (seeds, targetIndex, fallbackId) => {
          const repo = new InMemoryVaultRepository();
          const draftRepo = new InMemoryDraftRepository();

          // Populate both repos for every user across all tables, capturing the
          // ids each repo assigns so we can later probe getPrediction/getDraft.
          const createdPredictionIds = new Map<string, string[]>();
          const createdDraftIds = new Map<string, string[]>();
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
            const draftIds: string[] = [];
            for (const d of seed.drafts) {
              const created = await draftRepo.createDraft(userId, d);
              draftIds.push(created.id);
            }
            createdDraftIds.set(userId, draftIds);
          }

          const userIds = [...seeds.keys()];
          const targetUserId =
            userIds.length > 0 ? userIds[targetIndex % userIds.length] : fallbackId;

          // Snapshot every other user's rows (including drafts) before the delete.
          const otherUserIds = userIds.filter((id) => id !== targetUserId);
          const before = new Map<string, Awaited<ReturnType<typeof readUser>>>();
          for (const id of otherUserIds) {
            before.set(
              id,
              await readUser(repo, draftRepo, id, createdDraftIds.get(id) ?? []),
            );
          }

          // Act: the real DELETE helper clears both the vault and the drafts.
          await deleteVaultForUser(repo, draftRepo, targetUserId);

          // Assert: the target user holds zero rows across all four vault tables.
          expect(await repo.getProfile(targetUserId)).toBeNull();
          expect(await repo.listVaultEntries(targetUserId)).toEqual([]);
          expect(await repo.listAnswers(targetUserId)).toEqual([]);
          for (const predId of createdPredictionIds.get(targetUserId) ?? []) {
            expect(await repo.getPrediction(targetUserId, predId)).toBeNull();
          }

          // Assert: the target user's drafts are gone (deleteAllDrafts ran).
          for (const draftId of createdDraftIds.get(targetUserId) ?? []) {
            expect(await draftRepo.getDraft(targetUserId, draftId)).toBeNull();
          }

          // Assert: every other user's rows and drafts are exactly unchanged.
          for (const id of otherUserIds) {
            const after = await readUser(
              repo,
              draftRepo,
              id,
              createdDraftIds.get(id) ?? [],
            );
            expect(after).toEqual(before.get(id));
            // Predictions for other users remain retrievable by id.
            for (const predId of createdPredictionIds.get(id) ?? []) {
              expect(await repo.getPrediction(id, predId)).not.toBeNull();
            }
            // Drafts for other users remain retrievable by id.
            for (const draftId of createdDraftIds.get(id) ?? []) {
              expect(await draftRepo.getDraft(id, draftId)).not.toBeNull();
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
