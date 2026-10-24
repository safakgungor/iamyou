// Feature: mind-tree — GET /api/mind.
//
// The core (`getMind` in lib/mind/service) runs on InMemoryVaultRepository
// with a mocked MindClaude whose `groupEntries` the test controls. The thin
// handler is exercised too, with the Supabase server client, the Supabase
// repository, Claude and `after` mocked, so auth and wiring are covered.
//
// Covered: Maya's seeded vault opens on the pre-grown tree with no model call;
// a new correction regrows it (provisional `mixed` + pending, then `model`);
// one grouping job per vault version; cited ids are checked; a failing model
// falls back to keywords and is not retried at once; an empty vault; 401.
import { beforeEach, describe, expect, it, vi } from "vitest";

import maya from "@/data/synthetic/maya/vault-entries.json";
import { InMemoryVaultRepository, type VaultEntry } from "@/lib/db/vault-repository";
import type { MindClaude } from "@/lib/mind/types";
import type { ClaudeTree, MindResponse } from "@/lib/mind/schemas";
import { createMindCache, getMind, type MindCache } from "@/lib/mind/service";

const h = vi.hoisted(() => ({
  user: null as { id: string } | null,
  repo: null as unknown,
  claude: null as unknown,
  scheduled: [] as Promise<unknown>[],
}));

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: vi.fn((task: () => Promise<unknown>) => {
      h.scheduled.push(task());
    }),
  };
});

vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
  })),
}));

vi.mock("@/lib/db/vault-repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/vault-repository")>();
  return {
    ...actual,
    SupabaseVaultRepository: class {
      constructor() {
        return h.repo as object;
      }
    },
  };
});

vi.mock("@/lib/mind/claude", () => ({
  defaultMindClaude: () => h.claude,
}));

import { GET } from "@/app/api/mind/route";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const USER = "user-1";

async function seedMaya(repo: InMemoryVaultRepository, userId = USER) {
  for (const e of maya) {
    await repo.upsertVaultEntry(userId, {
      id: e.id,
      kind: e.kind as VaultEntry["kind"],
      text: e.text,
      createdAt: e.created_at,
    });
  }
  await repo.upsertProfile(userId, {
    firstName: "Maya",
    lastName: "Linden",
    dateOfBirth: null,
    county: null,
    familyHistory: "prefer_not",
    healthLayerOptIn: true,
    rtkSetting: "tell_me",
    digitalWill: null,
    synthetic: true,
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** A MindClaude whose grouping returns whatever the test hands it. */
function mockClaude(group: (entries: readonly VaultEntry[]) => Promise<ClaudeTree | null>) {
  const calls: Array<readonly VaultEntry[]> = [];
  const claude: MindClaude = {
    groupEntries: async (entries) => {
      calls.push(entries);
      return group(entries);
    },
    answerFromVault: async () => null,
  };
  return { claude, calls };
}

const cited = (m: MindResponse) => m.tree.branches.flatMap((b) => b.nodes.flatMap((n) => n.entry_ids));
const labels = (m: MindResponse) => m.tree.branches.flatMap((b) => b.nodes.map((n) => n.label));

let repo: InMemoryVaultRepository;
let cache: MindCache;

beforeEach(() => {
  repo = new InMemoryVaultRepository();
  cache = createMindCache();
});

/* -------------------------------------------------------------------------- */
/* getMind                                                                    */
/* -------------------------------------------------------------------------- */

describe("getMind — Maya's seeded vault", () => {
  it("opens on the pre-grown tree without calling Claude", async () => {
    await seedMaya(repo);
    const { claude, calls } = mockClaude(async () => null);

    const mind = await getMind({ repo, claude, cache }, USER);

    expect(calls).toHaveLength(0);
    expect(mind).toMatchObject({ name: "Maya", learned: 33, source: "model", pending: false });
    expect(labels(mind)).toContain("Dad's bike-chain lesson");
    expect(mind.entries.map((e) => e.kind)).not.toContain("style_example");
    expect(mind.entries).toHaveLength(33);
  });

  it("regrows after a new correction: provisional first, then Claude's tree", async () => {
    await seedMaya(repo);
    const gate = deferred<void>();
    const { claude, calls } = mockClaude(async (entries) => {
      await gate.promise;
      return {
        branches: [
          {
            branch: "body",
            nodes: [{ label: "Porch tea before runs", fact: "You take tea on the porch before runs.", entry_ids: entries.map((e) => e.id).filter((id) => !id.startsWith("v0")) }],
          },
        ],
      };
    });
    const scheduled: Promise<unknown>[] = [];
    const deps = { repo, claude, cache, schedule: (job: Promise<unknown>) => void scheduled.push(job) };

    await getMind(deps, USER); // the first visit, on the pre-grown tree
    const added = await repo.addVaultEntry(USER, {
      kind: "correction",
      text: "[correction:p-1] These days I take my tea on the porch before every run.",
      createdAt: "2026-10-24T10:00:00.000Z",
    });

    const provisional = await getMind(deps, USER);
    expect(provisional).toMatchObject({ learned: 34, source: "mixed", pending: true });
    expect(cited(provisional)).toContain(added.id);
    expect(labels(provisional)).toContain("Dad's bike-chain lesson"); // the grown part is kept
    expect(scheduled).toHaveLength(1);

    // A poll while the job runs starts no second job.
    expect((await getMind(deps, USER)).pending).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].map((e) => e.text)).toContain("These days I take my tea on the porch before every run.");

    gate.resolve();
    await scheduled[0];

    const grown = await getMind(deps, USER);
    expect(grown).toMatchObject({ learned: 34, source: "model", pending: false });
    const node = grown.tree.branches.find((b) => b.id === "body")!.nodes.find((n) => n.entry_ids.includes(added.id))!;
    expect(node.label).toBe("Porch tea before runs");
    expect(calls).toHaveLength(1);
  });
});

describe("getMind — any vault", () => {
  const entries: VaultEntry[] = [
    { id: "a", kind: "story", text: "I ran the Boston marathon in the rain.", createdAt: "2030-01-01T00:00:00Z" },
    { id: "b", kind: "opinion", text: "Kindness and honesty go together.", createdAt: "2030-02-01T00:00:00Z" },
    { id: "s", kind: "style_example", text: "Hi team, quick update.", createdAt: "2030-03-01T00:00:00Z" },
  ];

  beforeEach(async () => {
    for (const e of entries) await repo.upsertVaultEntry(USER, e);
  });

  it("keeps only real, non-style ids from Claude and places what it missed", async () => {
    const { claude } = mockClaude(async () => ({
      branches: [
        { branch: "body", nodes: [{ label: "Boston marathon", fact: "You ran it in the rain.", entry_ids: ["a", "ghost", "s"] }] },
        { branch: "work", nodes: [{ label: "Made up", fact: "Nothing real.", entry_ids: ["zzz"] }] },
      ],
    }));

    const mind = await getMind({ repo, claude, cache, waitMs: 1000 }, USER);

    expect(mind).toMatchObject({ name: "You", source: "model", pending: false, learned: 2 });
    expect(cited(mind).sort()).toEqual(["a", "b"]);
    expect(labels(mind)).toContain("Boston marathon");
    expect(labels(mind)).not.toContain("Made up");
  });

  it("serves the keyword tree while Claude has not answered", async () => {
    const gate = deferred<ClaudeTree | null>();
    const { claude } = mockClaude(() => gate.promise);

    const mind = await getMind({ repo, claude, cache }, USER);

    expect(mind).toMatchObject({ source: "keywords", pending: true, learned: 2 });
    gate.resolve(null);
  });

  it("falls back to keywords when Claude fails, and does not retry at once", async () => {
    let now = 1_000_000;
    const { claude, calls } = mockClaude(async () => null);
    const deps = { repo, claude, cache, now: () => now };

    const first = await getMind(deps, USER);
    expect(first).toMatchObject({ source: "keywords", pending: false, learned: 2 });
    expect(cited(first).sort()).toEqual(["a", "b"]);

    await getMind(deps, USER);
    expect(calls).toHaveLength(1);

    now += 3 * 60_000;
    await getMind(deps, USER);
    expect(calls).toHaveLength(2);
  });

  it("falls back to keywords when Claude throws", async () => {
    const { claude } = mockClaude(async () => {
      throw new Error("network");
    });
    const mind = await getMind({ repo, claude, cache }, USER);
    expect(mind).toMatchObject({ source: "keywords", pending: false, learned: 2 });
  });
});

describe("getMind — empty vault", () => {
  it("returns five empty branches and nothing learned, without calling Claude", async () => {
    const { claude, calls } = mockClaude(async () => null);
    const mind = await getMind({ repo, claude, cache }, USER);
    expect(mind.learned).toBe(0);
    expect(mind.tree.branches).toHaveLength(5);
    expect(mind.tree.branches.every((b) => b.nodes.length === 0)).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* GET handler                                                                */
/* -------------------------------------------------------------------------- */

describe("GET /api/mind", () => {
  beforeEach(() => {
    (globalThis as { __iamyouMindCache?: unknown }).__iamyouMindCache = undefined;
    h.repo = repo;
    h.scheduled = [];
  });

  it("responds 401 when there is no caller", async () => {
    h.user = null;
    h.claude = mockClaude(async () => null).claude;
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("responds 200 with the caller's tree and keeps the regrow alive with after()", async () => {
    h.user = { id: USER };
    await seedMaya(repo);
    await repo.addVaultEntry(USER, { kind: "correction", text: "I'm a runner first.", createdAt: "2026-10-24T10:00:00Z" });
    const gate = deferred<ClaudeTree | null>();
    const mock = mockClaude(() => gate.promise);
    h.claude = mock.claude;

    const res = await GET();
    const body = (await res.json()) as MindResponse;

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(body).toMatchObject({ name: "Maya", learned: 34, pending: true });
    expect(h.scheduled).toHaveLength(1);

    gate.resolve(null);
    await h.scheduled[0];
  });
});
