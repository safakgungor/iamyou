// Feature: care-outputs, Task 12.2: unit tests for GET and POST /api/family.
//
// `getFamilyAskers` and `answerFamilyQuestion` run against an in-memory vault
// seeded with Maya's synthetic profile and entries, and a mocked Claude, so no
// test reaches Supabase or the Anthropic API.
//
// Validates: Requirements 9.1, 9.2, 9.4, 10.2, 10.5, 10.6
import { describe, expect, it, vi } from "vitest";

import { mayaDemoProfile, mayaDemoVaultEntries, seedDemo } from "@/app/api/demo/start/route";
import {
  answerFamilyQuestion,
  getFamilyAskers,
  type FamilyClaude,
} from "@/app/api/family/route";
import { InMemoryVaultRepository, type Profile, type VaultEntry } from "@/lib/db/vault-repository";
import type { FamilyAnswer } from "@/lib/family";

const USER_ID = "user-1";
const ELLA = "Ella Linden (daughter)";
const DONT_KNOW = "I don't know how Maya would answer that.";

async function mayaVault(profile: Profile = mayaDemoProfile(), entries: VaultEntry[] = mayaDemoVaultEntries()) {
  const vault = new InMemoryVaultRepository();
  await seedDemo(vault, USER_ID, profile, entries);
  return vault;
}

function mockClaude(answer: FamilyAnswer) {
  const familyAnswer = vi.fn<FamilyClaude["familyAnswer"]>(async () => answer);
  return { claude: { familyAnswer } satisfies FamilyClaude, familyAnswer };
}

describe("getFamilyAskers (GET /api/family)", () => {
  it("returns Maya's daughter as the asker, with the synthetic label (Req 9.1)", async () => {
    expect(await getFamilyAskers(await mayaVault(), USER_ID)).toEqual({
      status: 200,
      body: { first_name: "Maya", askers: [ELLA], synthetic_label: "Synthetic data" },
    });
  });

  it("returns 404 without a profile", async () => {
    expect(await getFamilyAskers(new InMemoryVaultRepository(), USER_ID)).toEqual({
      status: 404,
      body: { error: "Profile not found" },
    });
  });
});

describe("answerFamilyQuestion (POST /api/family)", () => {
  it("refuses an unlisted asker with 403 and no Claude call", async () => {
    const vault = await mayaVault();
    const listSpy = vi.spyOn(vault, "listVaultEntries");
    const { claude, familyAnswer } = mockClaude({ answer: "x", cited_entry_ids: ["v001"] });

    expect(
      await answerFamilyQuestion(vault, claude, USER_ID, { asker: "Sam Linden (son)", question: "Hi?" }),
    ).toEqual({ status: 403, body: { error: "not_in_family_mode_access" } });
    expect(familyAnswer).not.toHaveBeenCalled();
    expect(listSpy).not.toHaveBeenCalled();
  });

  it("refuses every asker when the profile has no family_mode_access", async () => {
    const vault = await mayaVault({ ...mayaDemoProfile(), digitalWill: { decided_at_age: 31 } });
    const { claude, familyAnswer } = mockClaude({ answer: "x", cited_entry_ids: ["v001"] });

    const outcome = await answerFamilyQuestion(vault, claude, USER_ID, { asker: ELLA, question: "Hi?" });
    expect(outcome.status).toBe(403);
    expect(familyAnswer).not.toHaveBeenCalled();
  });

  it("returns 404 without a profile", async () => {
    const { claude } = mockClaude({ answer: "x", cited_entry_ids: [] });
    const outcome = await answerFamilyQuestion(new InMemoryVaultRepository(), claude, USER_ID, {
      asker: ELLA,
      question: "Hi?",
    });
    expect(outcome.status).toBe(404);
  });

  it("returns the Dont_Know_Answer without calling Claude when no allowed entry exists (Req 9.4)", async () => {
    const styleOnly = mayaDemoVaultEntries().filter((e) => e.kind === "style_example");
    const vault = await mayaVault(mayaDemoProfile(), styleOnly);
    const { claude, familyAnswer } = mockClaude({ answer: "x", cited_entry_ids: [styleOnly[0].id] });

    expect(await answerFamilyQuestion(vault, claude, USER_ID, { asker: ELLA, question: "Hi?" })).toEqual({
      status: 200,
      body: { asker: ELLA, answer: DONT_KNOW, cited_entries: [], synthetic_label: "Synthetic data" },
    });
    expect(familyAnswer).not.toHaveBeenCalled();
  });

  it("never sends a style_example and sends at most 40 entries (Req 9.2)", async () => {
    const many: VaultEntry[] = Array.from({ length: 60 }, (_, i) => ({
      id: `e${i}`,
      kind: i % 3 === 0 ? "style_example" : "story",
      text: `entry ${i}`,
      createdAt: `2030-01-${String((i % 28) + 1).padStart(2, "0")}`,
    }));
    const vault = await mayaVault(mayaDemoProfile(), many);
    const { claude, familyAnswer } = mockClaude({ answer: "x", cited_entry_ids: [] });

    await answerFamilyQuestion(vault, claude, USER_ID, { asker: ELLA, question: "Hi?" });
    const sent = familyAnswer.mock.calls[0][0];
    expect(sent.entries).toHaveLength(40);
    expect(sent.entries.some((e) => e.kind === "style_example")).toBe(false);
    expect(sent).toMatchObject({ firstName: "Maya", question: "Hi?" });
  });

  it("returns only the real cited entry when Claude also cites an unknown id (Req 10.5)", async () => {
    const vault = await mayaVault();
    const { claude } = mockClaude({
      answer: "I'd make you check it three times.",
      cited_entry_ids: ["v404", "v001"],
    });

    const outcome = await answerFamilyQuestion(vault, claude, USER_ID, {
      asker: ELLA,
      question: "What did Grandpa teach you?",
    });
    const v001 = mayaDemoVaultEntries().find((e) => e.id === "v001");
    expect(outcome).toEqual({
      status: 200,
      body: {
        asker: ELLA,
        answer: "I'd make you check it three times.",
        cited_entries: [{ id: "v001", kind: "story", text: v001?.text }],
        synthetic_label: "Synthetic data",
      },
    });
  });

  it("keeps citation order and drops a cited style example that was never sent", async () => {
    const vault = await mayaVault();
    // v034 is one of Maya's style examples.
    const { claude } = mockClaude({ answer: "Yes.", cited_entry_ids: ["v003", "v034", "v002"] });

    const outcome = await answerFamilyQuestion(vault, claude, USER_ID, { asker: ELLA, question: "?" });
    const ids = (outcome.body as { cited_entries: Array<{ id: string }> }).cited_entries.map((e) => e.id);
    expect(ids).toEqual(["v003", "v002"]);
  });

  it("returns the Dont_Know_Answer and no entries when Claude cites nothing (Req 10.2, 10.6)", async () => {
    const vault = await mayaVault();
    const { claude } = mockClaude({ answer: "Something invented.", cited_entry_ids: [] });

    expect(await answerFamilyQuestion(vault, claude, USER_ID, { asker: ELLA, question: "?" })).toEqual({
      status: 200,
      body: { asker: ELLA, answer: DONT_KNOW, cited_entries: [], synthetic_label: "Synthetic data" },
    });
  });
});
