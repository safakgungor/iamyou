// Feature: mind-tree — POST /api/mind/ask ("Ask about yourself").
//
// The core (`askMind` in lib/mind/service) runs on InMemoryVaultRepository
// with a mocked MindClaude; the thin handler is exercised with Supabase and
// Claude mocked for auth and body validation.
//
// Covered: answers quote only real, non-style entries with their own text;
// nothing found says so; crisis → 988, genetic testing → genetic counselor,
// health readings → the doctor sentence (before Claude and from Claude); a
// diagnosis-sounding answer is never shown; a failed call falls back to
// keyword search; an empty vault; 401 and 400.
import { beforeEach, describe, expect, it, vi } from "vitest";

import maya from "@/data/synthetic/maya/vault-entries.json";
import { InMemoryVaultRepository, type VaultEntry } from "@/lib/db/vault-repository";
import type { MindClaude } from "@/lib/mind/types";
import { HEALTH_MESSAGE } from "@/lib/mind/safety";
import type { ClaudeAnswer, MindAskResponse } from "@/lib/mind/schemas";
import { askMind, EMPTY_VAULT_ANSWER, NOTHING_FOUND_ANSWER, QUOTE_LEAD } from "@/lib/mind/service";
import { COUNSELOR_MESSAGE, SUPPORT_MESSAGE } from "@/lib/safety";

const h = vi.hoisted(() => ({
  user: null as { id: string } | null,
  repo: null as unknown,
  claude: null as unknown,
}));

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

import { POST } from "@/app/api/mind/ask/route";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const USER = "user-1";

const TEXT = new Map(maya.map((e) => [e.id, e.text]));

/** A MindClaude whose answer the test sets; records every question it gets. */
function mockClaude(answer: ClaudeAnswer | null) {
  const questions: string[] = [];
  const claude: MindClaude = {
    groupEntries: async () => null,
    answerFromVault: async (question) => {
      questions.push(question);
      return answer;
    },
  };
  return { claude, questions };
}

let repo: InMemoryVaultRepository;

beforeEach(async () => {
  repo = new InMemoryVaultRepository();
  for (const e of maya) {
    await repo.upsertVaultEntry(USER, {
      id: e.id,
      kind: e.kind as VaultEntry["kind"],
      text: e.text,
      createdAt: e.created_at,
    });
  }
});

/* -------------------------------------------------------------------------- */
/* askMind                                                                    */
/* -------------------------------------------------------------------------- */

describe("askMind — answers from the vault", () => {
  it("quotes only real, non-style entries, with their own text", async () => {
    const { claude } = mockClaude({
      status: "answered",
      answer: "You turned down Seattle to stay three hours from your mom.",
      entry_ids: ["v005", "v005", "ghost", "v039", "v013"],
    });

    const res = await askMind({ repo, claude }, USER, "Why did I turn down Seattle?");

    expect(res.kind).toBe("answer");
    expect(res.source).toBe("model");
    expect(res.answer).toBe("You turned down Seattle to stay three hours from your mom.");
    expect(res.sources.map((s) => s.id)).toEqual(["v005", "v013"]);
    for (const s of res.sources) expect(s.text).toBe(TEXT.get(s.id));
  });

  it("says so when the vault has nothing on it", async () => {
    const notFound = await askMind({ repo, claude: mockClaude({ status: "not_in_vault", answer: "", entry_ids: [] }).claude }, USER, "What is my favourite film?");
    expect(notFound).toMatchObject({ kind: "empty", answer: NOTHING_FOUND_ANSWER, sources: [] });

    // An "answer" that cites nothing real is not an answer.
    const uncited = await askMind(
      { repo, claude: mockClaude({ status: "answered", answer: "You love jazz.", entry_ids: ["made-up"] }).claude },
      USER,
      "What music do I like?",
    );
    expect(uncited).toMatchObject({ kind: "empty", answer: NOTHING_FOUND_ANSWER, sources: [] });
  });

  it("falls back to keyword search when Claude fails", async () => {
    const res = await askMind({ repo, claude: mockClaude(null).claude }, USER, "What did I say about running?");
    expect(res).toMatchObject({ kind: "answer", answer: QUOTE_LEAD, source: "keywords" });
    expect(res.sources.map((s) => s.id)).toEqual(expect.arrayContaining(["v019", "v021"]));

    const none = await askMind({ repo, claude: mockClaude(null).claude }, USER, "What is my favourite film?");
    expect(none).toMatchObject({ kind: "empty", answer: NOTHING_FOUND_ANSWER, source: "keywords" });
  });

  it("tells an empty vault to start with a check-in, without calling Claude", async () => {
    const { claude, questions } = mockClaude(null);
    const res = await askMind({ repo: new InMemoryVaultRepository(), claude }, USER, "Who am I?");
    expect(res).toMatchObject({ kind: "empty", answer: EMPTY_VAULT_ANSWER });
    expect(questions).toHaveLength(0);
  });
});

describe("askMind — safety", () => {
  it.each([
    ["I want to end my life", "support", SUPPORT_MESSAGE],
    ["Should I get a genetic test for Huntington's?", "counselor", COUNSELOR_MESSAGE],
    ["Am I showing signs of memory loss?", "health", HEALTH_MESSAGE],
  ] as const)("answers %j with the fixed %s message before Claude", async (question, kind, message) => {
    const { claude, questions } = mockClaude({ status: "answered", answer: "Anything.", entry_ids: ["v001"] });
    const res = await askMind({ repo, claude }, USER, question);
    expect(res).toEqual({ kind, answer: message, sources: [], source: "rules" });
    expect(questions).toHaveLength(0);
  });

  it("points crisis language to 988", async () => {
    const res = await askMind({ repo, claude: mockClaude(null).claude }, USER, "Sometimes I want to die");
    expect(res.answer).toContain("988");
  });

  it.each([
    ["crisis", "support", SUPPORT_MESSAGE],
    ["genetics", "counselor", COUNSELOR_MESSAGE],
    ["health", "health", HEALTH_MESSAGE],
  ] as const)("maps Claude's %s status to the fixed message", async (status, kind, message) => {
    const res = await askMind(
      { repo, claude: mockClaude({ status, answer: "ignored", entry_ids: ["v001"] }).claude },
      USER,
      "Tell me something about myself",
    );
    expect(res).toEqual({ kind, answer: message, sources: [], source: "model" });
  });

  it("never shows an answer that sounds like a diagnosis", async () => {
    const res = await askMind(
      {
        repo,
        claude: mockClaude({
          status: "answered",
          answer: "You might have early signs of memory trouble, like your dad.",
          entry_ids: ["v002"],
        }).claude,
      },
      USER,
      "What happened on my birthday?",
    );
    expect(res.kind).toBe("answer");
    expect(res.answer).toBe(QUOTE_LEAD);
    expect(res.sources.map((s) => s.id)).toEqual(["v002"]);
  });
});

/* -------------------------------------------------------------------------- */
/* POST handler                                                               */
/* -------------------------------------------------------------------------- */

function post(body: unknown): Request {
  return new Request("http://localhost/api/mind/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/mind/ask", () => {
  beforeEach(() => {
    h.repo = repo;
    h.claude = mockClaude({ status: "answered", answer: "Mom first, then Dad.", entry_ids: ["v020"] }).claude;
  });

  it("responds 401 when there is no caller", async () => {
    h.user = null;
    const res = await POST(post({ question: "Who do I call?" }));
    expect(res.status).toBe(401);
  });

  it.each([
    ["no question", {}],
    ["an empty question", { question: "   " }],
    ["a question over 280 characters", { question: "a".repeat(281) }],
    ["invalid JSON", "{"],
  ])("responds 400 for %s", async (_name, body) => {
    h.user = { id: USER };
    const res = await POST(post(body));
    expect(res.status).toBe(400);
  });

  it("responds 200 with the answer and its sources", async () => {
    h.user = { id: USER };
    const res = await POST(post({ question: "Who do I call with good news?" }));
    const body = (await res.json()) as MindAskResponse;
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ kind: "answer", answer: "Mom first, then Dad.", source: "model" });
    expect(body.sources.map((s) => s.id)).toEqual(["v020"]);
  });
});
