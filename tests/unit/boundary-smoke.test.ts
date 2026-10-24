// Feature: twin-loop, Task 18.1 + assistant-tasks, Task 12.1: boundary / smoke tests.
//
// Three kinds of guardrail live here:
//
//   1. Data boundary — the synthetic check-in deck must hold EXACTLY 20 prompts.
//      The check-in route picks "the lowest-numbered unanswered prompt in the
//      session", so a deck that silently grows or shrinks would quietly change
//      the loop's behaviour. We import the JSON directly and assert its length
//      (Req 4.1).
//
//      The assistant-tasks inbox is the same kind of guardrail: the synthetic
//      inbox at `data/synthetic/maya/inbox.json` must parse as an Inbox_Message
//      collection and MUST include the doctor's-office appointment message
//      ("Dr. Lee's office, Valley Family Medicine"), which the whole
//      draft-a-reply flow is demoed against. We import the JSON directly and
//      assert its shape and that message's presence (assistant-tasks Req 1.4).
//
//   2. Server-only boundary — the Claude SDK, the `@/lib/claude` layer, and the
//      Supabase service-role key must never leak into client-reachable code.
//      Rather than trust imports, we read the repository off disk and grep the
//      *.ts / *.tsx sources under app/, components/ and lib/, asserting:
//        - no file carrying a `'use client'` directive imports the Claude layer
//          or the Anthropic SDK (twin-loop Req 4.6, 6.6 / assistant-tasks Req 3.6);
//        - every file that imports the Claude layer / SDK lives in the
//          server-only allow-set: app/api/** (server routes) or lib/claude/**
//          itself (twin-loop Req 4.6, 6.6 / assistant-tasks Req 3.6);
//        - `SUPABASE_SERVICE_ROLE_KEY` is referenced in exactly one source file,
//          app/api/demo/start/route.ts, and nowhere a client could reach
//          (Req 1.3, 1.4).
//
//      The scan is intentionally robust to the project growing: if no client
//      files exist yet the directive check passes vacuously, and it stays valid
//      as pages and hooks are added later.
//
// Validates: Requirements 1.3, 1.4, 4.1, 4.6, 6.6 (twin-loop);
//            Requirements 1.4, 3.6 (assistant-tasks)
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import prompts from "@/data/synthetic/checkin-prompts.json";
import inbox from "@/data/synthetic/maya/inbox.json";

/* -------------------------------------------------------------------------- */
/* Repo layout                                                                */
/* -------------------------------------------------------------------------- */

/** Absolute path to the repository root (this file lives in tests/unit). */
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Directories that may contain client-reachable or shared source. */
const SCAN_DIRS = ["app", "components", "lib"];

/**
 * Convert an absolute path to a repo-relative POSIX path (forward slashes) so
 * the allow-set checks below are stable across operating systems.
 */
function toPosixRelative(absPath: string): string {
  return relative(REPO_ROOT, absPath).split(sep).join("/");
}

/** Recursively collect every *.ts / *.tsx file under the given directory. */
function collectSourceFiles(absDir: string): string[] {
  if (!existsSync(absDir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    const abs = join(absDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      out.push(...collectSourceFiles(abs));
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      out.push(abs);
    }
  }
  return out;
}

/** Every scanned source file, as repo-relative POSIX paths. */
const SOURCE_FILES: string[] = SCAN_DIRS.flatMap((dir) =>
  collectSourceFiles(join(REPO_ROOT, dir)),
).map(toPosixRelative);

function read(relPath: string): string {
  return readFileSync(join(REPO_ROOT, relPath), "utf8");
}

/* -------------------------------------------------------------------------- */
/* Pattern matchers                                                           */
/* -------------------------------------------------------------------------- */

/** True when the file opts into the client with a `'use client'` directive. */
function hasUseClientDirective(source: string): boolean {
  // The directive must be a top-of-file string literal; a simple presence
  // check is sufficient and conservative here (it can only make the test
  // stricter, never weaker).
  return /^\s*['"]use client['"]/m.test(source);
}

/** True when the file imports the Anthropic SDK or the `@/lib/claude` layer. */
function importsClaudeLayer(source: string): boolean {
  // Match `from '@anthropic-ai/sdk'`, `from '@anthropic-ai/sdk/...'`,
  // `from '@/lib/claude'` and `from '@/lib/claude/...'` — plus relative
  // imports of the claude layer such as `from '../claude'` / `from './claude'`.
  return (
    /from\s+['"]@anthropic-ai\/sdk(?:\/[^'"]*)?['"]/.test(source) ||
    /from\s+['"]@\/lib\/claude(?:\/[^'"]*)?['"]/.test(source) ||
    /from\s+['"]\.{1,2}(?:\/[^'"]*)?\/claude(?:\/[^'"]*)?['"]/.test(source)
  );
}

/**
 * Server-only allow-set: a file may import the Claude layer only if it is a
 * server API route (`app/api/**`) or part of the Claude layer itself
 * (`lib/claude/**`).
 */
function isServerOnlyLocation(relPath: string): boolean {
  return relPath.startsWith("app/api/") || relPath.startsWith("lib/claude/");
}

/* -------------------------------------------------------------------------- */
/* 1. Data boundary                                                           */
/* -------------------------------------------------------------------------- */

describe("check-in prompt deck", () => {
  it("contains exactly 20 prompts (Req 4.1)", () => {
    expect(Array.isArray(prompts)).toBe(true);
    expect(prompts.length).toBe(20);
  });
});

/**
 * True when `value` is a well-formed Inbox_Message: the six required fields,
 * each of the right type, with `synthetic === true`. Mirrors the `loadInbox`
 * parser in `lib/inbox.ts` so the data boundary here matches what the service
 * accepts at request time (assistant-tasks Req 1.3).
 */
function isInboxMessage(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.from === "string" &&
    typeof record.subject === "string" &&
    typeof record.body === "string" &&
    typeof record.received_days_ago === "number" &&
    record.synthetic === true
  );
}

describe("assistant-tasks synthetic inbox", () => {
  it("parses as an Inbox_Message collection (assistant-tasks Req 1.4)", () => {
    expect(Array.isArray(inbox)).toBe(true);
    expect(inbox.length).toBeGreaterThan(0);
    expect(inbox.every(isInboxMessage)).toBe(true);
  });

  it("includes the Dr. Lee's office appointment message (assistant-tasks Req 1.4)", () => {
    const doctorMessage = inbox.find(
      (message) => message.from === "Dr. Lee's office, Valley Family Medicine",
    );

    expect(doctorMessage).toBeDefined();
    // Req 1.4: the body asks the user to confirm or reschedule an appointment.
    const body = (doctorMessage?.body ?? "").toLowerCase();
    expect(body).toContain("confirm");
    expect(body).toContain("reschedule");
  });
});

/* -------------------------------------------------------------------------- */
/* 2. Server-only boundary                                                    */
/* -------------------------------------------------------------------------- */

describe("Claude layer stays server-only", () => {
  it("is never imported by a 'use client' file (Req 4.6, 6.6)", () => {
    const offenders = SOURCE_FILES.filter((relPath) => {
      const source = read(relPath);
      return hasUseClientDirective(source) && importsClaudeLayer(source);
    });

    expect(offenders).toEqual([]);
  });

  it("is only imported from server-only locations (Req 4.6, 6.6)", () => {
    const importers = SOURCE_FILES.filter((relPath) =>
      importsClaudeLayer(read(relPath)),
    );

    const outsideAllowSet = importers.filter(
      (relPath) => !isServerOnlyLocation(relPath),
    );

    expect(outsideAllowSet).toEqual([]);
  });
});

describe("Supabase service-role key stays server-only", () => {
  const ALLOWED = "app/api/demo/start/route.ts";

  it("is referenced only in app/api/demo/start/route.ts (Req 1.3, 1.4)", () => {
    const referencingFiles = SOURCE_FILES.filter((relPath) =>
      read(relPath).includes("SUPABASE_SERVICE_ROLE_KEY"),
    );

    expect(referencingFiles).toEqual([ALLOWED]);
  });

  it("never appears in a 'use client' file (Req 1.3, 1.4)", () => {
    const clientLeaks = SOURCE_FILES.filter((relPath) => {
      const source = read(relPath);
      return (
        hasUseClientDirective(source) &&
        source.includes("SUPABASE_SERVICE_ROLE_KEY")
      );
    });

    expect(clientLeaks).toEqual([]);
  });
});
