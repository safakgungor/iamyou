// Feature: mind-tree, Property: the tree and the answers cite only the vault.
//
// For any vault and any grouping Claude might return (real ids, made-up ids,
// style-example ids, repeats, ids of Maya's pre-grown tree with other text),
// the mind tree cites only ids that exist in that vault, never a
// style_example, and every other entry exactly once. The same holds for the
// entries "Ask about yourself" quotes.
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import maya from "@/data/synthetic/maya/vault-entries.json";
import { InMemoryVaultRepository, type VaultEntry } from "@/lib/db/vault-repository";
import type { MindClaude } from "@/lib/mind/types";
import { sanitizeTree } from "@/lib/mind/fallback";
import type { ClaudeAnswer, ClaudeTree } from "@/lib/mind/schemas";
import { askMind, createMindCache, getMind } from "@/lib/mind/service";
import { BRANCH_IDS, type MindTree } from "@/lib/mind/types";

const KINDS: VaultEntry["kind"][] = ["conversation", "correction", "story", "opinion", "style_example"];

// Some vault ids collide with Maya's seeded ids, sometimes with her exact text,
// so the pre-grown tree's reuse path is exercised too.
const MAYA_IDS = maya.slice(0, 6).map((e) => e.id);
const MAYA_TEXT = new Map(maya.map((e) => [e.id, e.text]));
const ID_POOL = [...MAYA_IDS, ...Array.from({ length: 30 }, (_, i) => `e${i}`)];

const vaultArb = fc
  .array(
    fc.record({
      kind: fc.constantFrom(...KINDS),
      text: fc.oneof(fc.string(), fc.lorem({ maxCount: 12 })),
      mayaText: fc.boolean(),
      createdAt: fc
        .date({ min: new Date(Date.UTC(2020, 0, 1)), max: new Date(Date.UTC(2050, 0, 1)), noInvalidDate: true })
        .map((d) => d.toISOString()),
    }),
    { maxLength: ID_POOL.length },
  )
  .map((rows) =>
    rows.map(({ mayaText, ...row }, i): VaultEntry => {
      const id = ID_POOL[i];
      return { id, ...row, text: mayaText && MAYA_TEXT.has(id) ? MAYA_TEXT.get(id)! : row.text };
    }),
  );

const idArb = fc.oneof(fc.constantFrom(...ID_POOL), fc.string({ maxLength: 6 }));

const proposalArb: fc.Arbitrary<ClaudeTree> = fc.record({
  branches: fc.array(
    fc.record({
      branch: fc.constantFrom(...BRANCH_IDS),
      nodes: fc.array(
        fc.record({ label: fc.string(), fact: fc.string(), entry_ids: fc.array(idArb, { maxLength: 6 }) }),
        { maxLength: 8 },
      ),
    }),
    { maxLength: 7 },
  ),
});

const answerArb: fc.Arbitrary<ClaudeAnswer> = fc.record({
  status: fc.constantFrom("answered", "not_in_vault", "crisis", "genetics", "health"),
  answer: fc.lorem({ maxCount: 20 }),
  entry_ids: fc.array(idArb, { maxLength: 8 }),
});

/** The invariants every tree shown to the user must satisfy. */
function expectCitesOnlyTheVault(tree: MindTree, vault: VaultEntry[]) {
  const kinds = new Map(vault.map((e) => [e.id, e.kind]));
  const cited = tree.branches.flatMap((b) => b.nodes.flatMap((n) => n.entry_ids));

  expect(tree.branches.map((b) => b.id)).toEqual(BRANCH_IDS);
  for (const id of cited) {
    expect(kinds.has(id)).toBe(true);
    expect(kinds.get(id)).not.toBe("style_example");
  }
  // Every non-style entry appears exactly once.
  const eligible = vault.filter((e) => e.kind !== "style_example").map((e) => e.id);
  expect([...cited].sort()).toEqual([...eligible].sort());
  for (const node of tree.branches.flatMap((b) => b.nodes)) {
    expect(node.entry_ids.length).toBeGreaterThan(0);
    expect(node.label.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(5);
  }
}

function claudeReturning(tree: ClaudeTree | null, answer: ClaudeAnswer | null = null): MindClaude {
  return { groupEntries: async () => tree, answerFromVault: async () => answer };
}

async function repoWith(vault: VaultEntry[]): Promise<InMemoryVaultRepository> {
  const repo = new InMemoryVaultRepository();
  for (const e of vault) await repo.upsertVaultEntry("u", e);
  return repo;
}

describe("mind tree citations (Property: cites only the vault, never a style example)", () => {
  it("sanitizeTree keeps only this vault's non-style ids, each entry once", () => {
    fc.assert(
      fc.property(vaultArb, fc.option(proposalArb, { nil: null }), (vault, proposal) => {
        expectCitesOnlyTheVault(sanitizeTree(proposal, vault), vault);
      }),
      { numRuns: 200 },
    );
  });

  it("GET /api/mind's core holds it for any grouping Claude returns", async () => {
    await fc.assert(
      fc.asyncProperty(vaultArb, fc.option(proposalArb, { nil: null }), async (vault, proposal) => {
        const mind = await getMind(
          { repo: await repoWith(vault), claude: claudeReturning(proposal), cache: createMindCache(), waitMs: 1000 },
          "u",
        );
        expectCitesOnlyTheVault(mind.tree, vault);
        expect(mind.entries.every((e) => (e.kind as string) !== "style_example")).toBe(true);
        expect(mind.learned).toBe(vault.filter((e) => e.kind !== "style_example").length);
      }),
      { numRuns: 100 },
    );
  });

  it("POST /api/mind/ask's core quotes only this vault's non-style entries", async () => {
    await fc.assert(
      fc.asyncProperty(vaultArb, fc.option(answerArb, { nil: null }), fc.lorem({ maxCount: 8 }), async (vault, answer, question) => {
        const res = await askMind({ repo: await repoWith(vault), claude: claudeReturning(null, answer) }, "u", question);
        const kinds = new Map(vault.map((e) => [e.id, e.kind]));
        for (const source of res.sources) {
          expect(kinds.has(source.id)).toBe(true);
          expect(kinds.get(source.id)).not.toBe("style_example");
        }
      }),
      { numRuns: 100 },
    );
  });
});
