// Feature: mind-tree — the deterministic half: keyword grouping, the
// sanitizing gate every tree passes through, the vault version and the
// keyword search behind "Ask about yourself".
//
// Runs on Maya's real synthetic vault (data/synthetic/maya/vault-entries.json).
import { describe, expect, it } from "vitest";

import maya from "@/data/synthetic/maya/vault-entries.json";
import type { VaultEntry } from "@/lib/db/vault-repository";
import {
  classifyEntry,
  fallbackTree,
  labelFor,
  learnedCount,
  sanitizeTree,
  searchVault,
  vaultVersion,
} from "@/lib/mind/fallback";
import { BRANCHES } from "@/lib/mind/types";
import type { MindTree } from "@/lib/mind/types";

const MAYA: VaultEntry[] = maya.map((e) => ({
  id: e.id,
  kind: e.kind as VaultEntry["kind"],
  text: e.text,
  createdAt: e.created_at,
}));

const STYLE_IDS = new Set(MAYA.filter((e) => e.kind === "style_example").map((e) => e.id));
const ELIGIBLE_IDS = MAYA.filter((e) => e.kind !== "style_example").map((e) => e.id);

const byId = (id: string) => MAYA.find((e) => e.id === id)!;
const cited = (tree: MindTree) => tree.branches.flatMap((b) => b.nodes.flatMap((n) => n.entry_ids));

describe("fallbackTree on Maya's vault", () => {
  const tree = fallbackTree(MAYA);

  it("has the five branches in their fixed order", () => {
    expect(tree.branches.map((b) => b.id)).toEqual(BRANCHES.map((b) => b.id));
    expect(tree.branches.map((b) => b.label)).toEqual([
      "Family & friends",
      "Hobbies & body",
      "Study & mind",
      "Work & career",
      "Values & character",
    ]);
  });

  it("places every non-style entry exactly once and leaves style examples out", () => {
    const ids = cited(tree);
    expect(ids.sort()).toEqual([...ELIGIBLE_IDS].sort());
    expect(ids.some((id) => STYLE_IDS.has(id))).toBe(false);
    expect(learnedCount(tree)).toBe(33);
  });

  it("sorts entries by keyword into the branch they are about", () => {
    expect(classifyEntry(byId("v001"))).toBe("family"); // Dad and the bike chain
    expect(classifyEntry(byId("v004"))).toBe("body"); // the Burlington marathon
    expect(classifyEntry(byId("v003"))).toBe("mind"); // pre-med to neuroscience
    expect(classifyEntry(byId("v005"))).toBe("work"); // the Seattle job
    expect(classifyEntry(byId("v012"))).toBe("values"); // kindness and honesty
  });

  it("gives every node a short label and a one-line fact", () => {
    for (const node of tree.branches.flatMap((b) => b.nodes)) {
      const words = node.label.split(/\s+/);
      expect(words.length).toBeGreaterThanOrEqual(1);
      expect(words.length).toBeLessThanOrEqual(5);
      expect(node.fact.length).toBeGreaterThan(0);
      expect(node.fact.length).toBeLessThanOrEqual(160);
      expect(node.fact).not.toMatch(/\n/);
    }
    expect(labelFor(byId("v004"))).toBe("First marathon in Burlington");
    expect(labelFor(byId("v005"))).toBe("Job in Seattle");
  });

  it("orders each branch by the age of its entries", () => {
    for (const branch of tree.branches) {
      const dates = branch.nodes.map((n) => byId(n.entry_ids[0]).createdAt);
      expect(dates).toEqual([...dates].sort());
    }
  });
});

describe("sanitizeTree", () => {
  it("drops unknown ids, style examples and repeats, then places what is missing", () => {
    const tree = sanitizeTree(
      {
        branches: [
          {
            branch: "body",
            nodes: [
              { label: "Burlington marathon", fact: "You walked at mile 22.", entry_ids: ["v004", "nope", "v034"] },
              { label: "Same again", fact: "Repeat.", entry_ids: ["v004"] },
              { label: "Ghost", fact: "Only made-up ids.", entry_ids: ["x1", "x2"] },
            ],
          },
        ],
      },
      MAYA,
    );

    const ids = cited(tree);
    expect(ids.filter((id) => id === "v004")).toHaveLength(1);
    expect(ids).not.toContain("nope");
    expect(ids).not.toContain("v034");
    expect(ids.sort()).toEqual([...ELIGIBLE_IDS].sort());

    const body = tree.branches.find((b) => b.id === "body")!;
    expect(body.nodes.find((n) => n.entry_ids.includes("v004"))?.label).toBe("Burlington marathon");
    expect(tree.branches.flatMap((b) => b.nodes).map((n) => n.label)).not.toContain("Ghost");
  });

  it("trims a long label to five words and a fact to one line", () => {
    const tree = sanitizeTree(
      {
        branches: [
          {
            branch: "values",
            nodes: [
              {
                label: "  A label that is much too long to fit.  ",
                fact: "Line one\nline two",
                entry_ids: ["v012"],
              },
            ],
          },
        ],
      },
      MAYA,
    );
    const node = tree.branches.find((b) => b.id === "values")!.nodes.find((n) => n.entry_ids.includes("v012"))!;
    expect(node.label).toBe("A label that is much");
    expect(node.fact).toBe("Line one line two");
  });

  it("returns five empty branches for an empty vault", () => {
    const tree = sanitizeTree(null, []);
    expect(tree.branches).toHaveLength(5);
    expect(learnedCount(tree)).toBe(0);
  });
});

describe("vaultVersion", () => {
  it("changes when a correction is added", () => {
    const before = vaultVersion(MAYA);
    const after = vaultVersion([
      ...MAYA,
      { id: "c1", kind: "correction", text: "I prefer tea now.", createdAt: "2026-10-24T10:00:00.000Z" },
    ]);
    expect(after).not.toBe(before);
    expect(after.startsWith("34.")).toBe(true);
  });

  it("ignores style examples, which never reach the tree", () => {
    const after = vaultVersion([
      ...MAYA,
      { id: "s1", kind: "style_example", text: "Hi team, short version.", createdAt: "2048-01-01T00:00:00.000Z" },
    ]);
    expect(after).toBe(vaultVersion(MAYA));
  });

  it("leaves the correction route's marker out of labels and facts", () => {
    const tree = fallbackTree([
      { id: "c1", kind: "correction", text: "[correction:p-1] I'm not a night owl.", createdAt: "2026-10-24T10:00:00.000Z" },
    ]);
    const node = tree.branches.flatMap((b) => b.nodes)[0];
    expect(node.label).toBe("I'm not a night owl");
    expect(node.fact).toBe("I'm not a night owl.");
  });
});

describe("searchVault", () => {
  it("finds entries by stem and never returns style examples", () => {
    const ids = searchVault("What did I say about running?", MAYA).map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining(["v019", "v021"]));
    expect(ids.some((id) => STYLE_IDS.has(id))).toBe(false);
  });

  it("returns nothing when no word matches", () => {
    expect(searchVault("What is my favourite film?", MAYA)).toEqual([]);
    expect(searchVault("?", MAYA)).toEqual([]);
  });
});
