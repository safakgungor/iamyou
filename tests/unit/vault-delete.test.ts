// Feature: twin-loop, Task 16.2: unit tests for DELETE /api/vault.
//
// These tests exercise `deleteVaultForUser` — the HTTP-free core of the
// one-tap delete route — against an InMemoryVaultRepository. They prove that:
//   - the helper returns the validated `{ ok: true }` payload (Req 3.5);
//   - after deletion the caller owns zero rows across all four Vault tables:
//     the profile is gone, vault entries are empty, answers are empty, and the
//     seeded prediction is no longer retrievable (Req 3.5, 3.6);
//   - the helper delegates to `repo.deleteVault`, which leaves a second user's
//     rows untouched (Req 3.6).
//
// Validates: Requirements 3.5, 3.6
import { describe, expect, it } from "vitest";

import { deleteVaultForUser } from "@/app/api/vault/route";
import {
  InMemoryVaultRepository,
  type Profile,
} from "@/lib/db/vault-repository";

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
    const repo = new InMemoryVaultRepository();
    await seedUser(repo, USER_ID);

    const result = await deleteVaultForUser(repo, USER_ID);

    expect(result).toEqual({ ok: true });
  });

  it("leaves the caller owning zero rows across all four tables (Req 3.5, 3.6)", async () => {
    const repo = new InMemoryVaultRepository();
    const predictionId = await seedUser(repo, USER_ID);

    // Sanity check: the user owns rows before the delete.
    expect(await repo.getProfile(USER_ID)).not.toBeNull();
    expect(await repo.listVaultEntries(USER_ID)).toHaveLength(1);
    expect(await repo.listAnswers(USER_ID)).toHaveLength(1);
    expect(await repo.getPrediction(USER_ID, predictionId)).not.toBeNull();

    await deleteVaultForUser(repo, USER_ID);

    expect(await repo.getProfile(USER_ID)).toBeNull();
    expect(await repo.listVaultEntries(USER_ID)).toEqual([]);
    expect(await repo.listAnswers(USER_ID)).toEqual([]);
    expect(await repo.listSessionAnswers(USER_ID, SESSION_ID)).toEqual([]);
    expect(await repo.getPrediction(USER_ID, predictionId)).toBeNull();
  });

  it("delegates to repo.deleteVault, leaving another user's rows untouched (Req 3.6)", async () => {
    const repo = new InMemoryVaultRepository();
    const callerPrediction = await seedUser(repo, USER_ID);
    const otherPrediction = await seedUser(repo, OTHER_USER_ID);

    await deleteVaultForUser(repo, USER_ID);

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
});
