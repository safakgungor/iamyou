// Feature: twin-loop, Task 16.2: unit tests for DELETE /api/vault.
// Feature: health-baseline, Task 14.3: weekly_features rows are deleted too.
//
// These tests exercise `deleteVaultForUser` — the HTTP-free core of the
// one-tap delete route — against an InMemoryVaultRepository,
// InMemoryDraftRepository and InMemoryWeeklyFeatureRepository. They prove that:
//   - the helper returns the validated `{ ok: true }` payload (Req 3.5);
//   - after deletion the caller owns zero rows across all four Vault tables:
//     the profile is gone, vault entries are empty, answers are empty, and the
//     seeded prediction is no longer retrievable (Req 3.5, 3.6);
//   - the helper delegates to `repo.deleteVault`, which leaves a second user's
//     rows untouched (Req 3.6);
//   - the caller's `weekly_features` rows are removed while another user's are
//     kept unchanged (health-baseline Req 2.11).
//
// Validates: Requirements 3.5, 3.6 (twin-loop); 2.11 (health-baseline)
import { describe, expect, it } from "vitest";

import { deleteVaultForUser } from "@/app/api/vault/route";
import {
  InMemoryVaultRepository,
  type Profile,
} from "@/lib/db/vault-repository";
import { InMemoryDraftRepository } from "@/lib/db/draft-repository";
import { InMemoryWeeklyFeatureRepository } from "@/lib/db/weekly-feature-repository";
import type { WeeklyFeatureRow } from "@/lib/baseline";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const USER_ID = "user-1";
const OTHER_USER_ID = "user-2";
const SESSION_ID = "session-1";

/** A complete, valid profile the seed can upsert for any user. */
function makeProfile(): Profile {
  return {
    firstName: "Test",
    lastName: "Person",
    dateOfBirth: "2008-03-14",
    county: "Middlesex",
    familyHistory: "none",
    healthLayerOptIn: false,
    rtkSetting: "record_only",
    digitalWill: null,
    synthetic: true,
  };
}

/** Two synthetic weekly_features rows; one has a null (missing) feature. */
function makeWeeklyRows(): WeeklyFeatureRow[] {
  return [
    {
      weekStart: "2026-01-05",
      synthetic: true,
      vocabulary_diversity: 0.62,
      mean_sentence_length: 14.2,
      filler_rate: 0.03,
      sleep_hours: 7.1,
      active_minutes: 210,
      twin_accuracy: 0.55,
    },
    {
      weekStart: "2026-01-12",
      synthetic: true,
      vocabulary_diversity: 0.6,
      mean_sentence_length: 13.8,
      filler_rate: 0.04,
      sleep_hours: null,
      active_minutes: 190,
      twin_accuracy: 0.58,
    },
  ];
}

/** All three repositories `deleteVaultForUser` needs, freshly constructed. */
function makeRepos() {
  return {
    repo: new InMemoryVaultRepository(),
    draftRepo: new InMemoryDraftRepository(),
    weeklyRepo: new InMemoryWeeklyFeatureRepository(),
  };
}

/**
 * Seeds one of every owned row kind for `userId`: a profile, a vault entry, a
 * prediction, and an answer referencing that prediction. Returns the stored
 * prediction's id so callers can later assert it is no longer retrievable.
 */
async function seedUser(
  repo: InMemoryVaultRepository,
  userId: string,
): Promise<string> {
  await repo.upsertProfile(userId, makeProfile());
  await repo.addVaultEntry(userId, {
    kind: "story",
    text: "A story I told my twin.",
  });
  const prediction = await repo.createPrediction(userId, {
    promptId: "c01",
    predictedText: "A prediction the twin made.",
  });
  await repo.createAnswer(userId, {
    predictionId: prediction.id,
    sessionId: SESSION_ID,
    answerText: "The real answer.",
    score: 0.5,
    crisis: false,
  });
  return prediction.id;
}

/* -------------------------------------------------------------------------- */
/* Tests                                                                      */
/* -------------------------------------------------------------------------- */

describe("deleteVaultForUser", () => {
  it("returns { ok: true } (Req 3.5)", async () => {
    const { repo, draftRepo, weeklyRepo } = makeRepos();
    await seedUser(repo, USER_ID);

    const result = await deleteVaultForUser(
      repo,
      draftRepo,
      weeklyRepo,
      USER_ID,
    );

    expect(result).toEqual({ ok: true });
  });

  it("leaves the caller owning zero rows across all four tables (Req 3.5, 3.6)", async () => {
    const { repo, draftRepo, weeklyRepo } = makeRepos();
    const predictionId = await seedUser(repo, USER_ID);

    // Sanity check: the user owns rows before the delete.
    expect(await repo.getProfile(USER_ID)).not.toBeNull();
    expect(await repo.listVaultEntries(USER_ID)).toHaveLength(1);
    expect(await repo.listAnswers(USER_ID)).toHaveLength(1);
    expect(await repo.getPrediction(USER_ID, predictionId)).not.toBeNull();

    await deleteVaultForUser(repo, draftRepo, weeklyRepo, USER_ID);

    expect(await repo.getProfile(USER_ID)).toBeNull();
    expect(await repo.listVaultEntries(USER_ID)).toEqual([]);
    expect(await repo.listAnswers(USER_ID)).toEqual([]);
    expect(await repo.listSessionAnswers(USER_ID, SESSION_ID)).toEqual([]);
    expect(await repo.getPrediction(USER_ID, predictionId)).toBeNull();
  });

  it("delegates to repo.deleteVault, leaving another user's rows untouched (Req 3.6)", async () => {
    const { repo, draftRepo, weeklyRepo } = makeRepos();
    const callerPrediction = await seedUser(repo, USER_ID);
    const otherPrediction = await seedUser(repo, OTHER_USER_ID);

    await deleteVaultForUser(repo, draftRepo, weeklyRepo, USER_ID);

    // The caller owns nothing...
    expect(await repo.getProfile(USER_ID)).toBeNull();
    expect(await repo.getPrediction(USER_ID, callerPrediction)).toBeNull();

    // ...while the second user's rows are all intact.
    expect(await repo.getProfile(OTHER_USER_ID)).not.toBeNull();
    expect(await repo.listVaultEntries(OTHER_USER_ID)).toHaveLength(1);
    expect(await repo.listAnswers(OTHER_USER_ID)).toHaveLength(1);
    expect(
      await repo.getPrediction(OTHER_USER_ID, otherPrediction),
    ).not.toBeNull();
  });

  it("removes the caller's weekly_features rows and keeps another user's (health-baseline Req 2.11)", async () => {
    const { repo, draftRepo, weeklyRepo } = makeRepos();
    await seedUser(repo, USER_ID);
    await seedUser(repo, OTHER_USER_ID);
    await weeklyRepo.upsertWeeklyFeatures(USER_ID, makeWeeklyRows());
    await weeklyRepo.upsertWeeklyFeatures(OTHER_USER_ID, makeWeeklyRows());

    // Sanity check: both users own weekly rows before the delete.
    expect(await weeklyRepo.listWeeklyFeatures(USER_ID)).toHaveLength(2);
    const otherBefore = await weeklyRepo.listWeeklyFeatures(OTHER_USER_ID);
    expect(otherBefore).toHaveLength(2);

    await deleteVaultForUser(repo, draftRepo, weeklyRepo, USER_ID);

    // The caller's weekly history is gone...
    expect(await weeklyRepo.listWeeklyFeatures(USER_ID)).toEqual([]);
    // ...while the other user's rows are unchanged.
    expect(await weeklyRepo.listWeeklyFeatures(OTHER_USER_ID)).toEqual(
      otherBefore,
    );
    expect(await weeklyRepo.listWeeklyFeatures(OTHER_USER_ID)).toEqual(
      makeWeeklyRows(),
    );
  });
});
