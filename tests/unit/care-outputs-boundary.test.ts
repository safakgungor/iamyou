// Feature: care-outputs, Task 14: boundary tests.
//
// Reads the sources off disk and asserts the layering rules:
//   - the pure modules `lib/summary.ts`, `lib/trials.ts` and `lib/family.ts`
//     import no `fs`, `next/*`, `@anthropic-ai/sdk` or `lib/claude`, and call no
//     `fetch` (Req 1.7, 7.7, 10.8);
//   - `@anthropic-ai/sdk` and `lib/claude` are imported only under `app/api/`
//     and `lib/claude/` (Req 9.7);
//   - the ClinicalTrials.gov API URL appears only in server code, the trials
//     route (Req 5.8);
//   - the care screens are client pages that never import the Claude layer.
//
// Validates: Requirements 1.7, 5.8, 7.7, 9.7, 10.8
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

function collect(absDir: string): string[] {
  if (!existsSync(absDir)) return [];
  return readdirSync(absDir, { withFileTypes: true }).flatMap((entry) => {
    const abs = join(absDir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : collect(abs);
    return /\.(ts|tsx)$/.test(entry.name) ? [abs] : [];
  });
}

const SOURCES = ["app", "components", "lib"]
  .flatMap((dir) => collect(join(REPO_ROOT, dir)))
  .map((abs) => relative(REPO_ROOT, abs).split(sep).join("/"));

const read = (relPath: string) => readFileSync(join(REPO_ROOT, relPath), "utf8");

/** Module specifiers of every static and dynamic import or re-export. */
function imports(source: string): string[] {
  const specs: string[] = [];
  for (const m of source.matchAll(/(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/g)) specs.push(m[1]);
  for (const m of source.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.push(m[1]);
  for (const m of source.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) specs.push(m[1]);
  return specs;
}

const isClaudeLayer = (spec: string) =>
  /^@anthropic-ai\/sdk(\/|$)/.test(spec) ||
  /^@\/lib\/claude(\/|$)/.test(spec) ||
  /^\.{1,2}(\/.*)?\/claude(\/|$)/.test(spec);

const PURE_MODULES = ["lib/summary.ts", "lib/trials.ts", "lib/family.ts"];

describe("care-outputs pure modules", () => {
  it.each(PURE_MODULES)("%s imports no I/O, framework or model code (Req 1.7, 7.7, 10.8)", (path) => {
    const source = read(path);
    for (const spec of imports(source)) {
      expect(spec).not.toMatch(/^(node:)?fs(\/|$)/);
      expect(spec).not.toMatch(/^next(\/|$)/);
      expect(isClaudeLayer(spec)).toBe(false);
      expect(spec).not.toMatch(/supabase/);
    }
    expect(source).not.toMatch(/\bfetch\s*\(/);
  });
});

describe("Claude layer stays in server code (Req 9.7)", () => {
  it("is imported only under app/api/ and lib/claude/", () => {
    const outside = SOURCES.filter(
      (path) =>
        imports(read(path)).some(isClaudeLayer) &&
        !path.startsWith("app/api/") &&
        !path.startsWith("lib/claude/") &&
        // The mind tree's own server-only Claude module (see boundary-smoke.test.ts).
        path !== "lib/mind/claude.ts",
    );
    expect(outside).toEqual([]);
  });

  it("is reached by the family route and no other care-outputs route", () => {
    expect(imports(read("app/api/family/route.ts")).some(isClaudeLayer)).toBe(true);
    expect(imports(read("app/api/summary/route.ts")).some(isClaudeLayer)).toBe(false);
    expect(imports(read("app/api/trials/route.ts")).some(isClaudeLayer)).toBe(false);
  });
});

describe("ClinicalTrials.gov API stays in server code (Req 5.8)", () => {
  it("is referenced only by the trials route", () => {
    const referencing = SOURCES.filter((path) => read(path).includes("clinicaltrials.gov/api"));
    expect(referencing).toEqual(["app/api/trials/route.ts"]);
  });
});

describe("care screens", () => {
  it.each(["app/(app)/summary/page.tsx", "app/(app)/trials/page.tsx", "app/(app)/family/page.tsx"])(
    "%s is a client page that never imports the Claude layer or calls an external API",
    (path) => {
      const source = read(path);
      expect(source).toMatch(/^'use client';/);
      expect(imports(source).some(isClaudeLayer)).toBe(false);
      for (const m of source.matchAll(/fetch\(\s*['"`]([^'"`]+)/g)) expect(m[1]).toMatch(/^\/api\//);
    },
  );

  it.each(["app/(app)/summary/page.tsx", "app/(app)/trials/page.tsx", "app/(app)/family/page.tsx"])(
    "%s leads back to the Care index",
    (path) => {
      expect(read(path)).toContain('<Link href="/care"');
    },
  );
});
