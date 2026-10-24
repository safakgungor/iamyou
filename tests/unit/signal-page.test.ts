// The public iamyou Signal page (/signal): every link goes somewhere real.
//
// Reads app/signal/page.tsx off disk and checks that each internal link is an
// existing route, each in-page anchor has its section, each figure exists in
// public/, and the external links are the report, the code and the dataset.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SOURCE = readFileSync(join(ROOT, "app/signal/page.tsx"), "utf8");

/** Every string value of an href or src attribute, including the FIGURES table. */
const targets = [
  ...SOURCE.matchAll(/(?:href|src)=["']([^"']+)["']/g),
  ...SOURCE.matchAll(/src: ['"]([^'"]+)['"]/g),
].map((m) => m[1]);

const CONSTANTS = Object.fromEntries(
  [...SOURCE.matchAll(/const (\w+) = '(https:[^']+)'/g)].map((m) => [m[1], m[2]]),
);

/** An app route exists when a page.tsx sits in its folder (route groups ignored). */
function routeExists(path: string): boolean {
  const clean = path.split(/[?#]/)[0].replace(/^\//, "");
  const candidates = [join(ROOT, "app", clean, "page.tsx"), join(ROOT, "app/(app)", clean, "page.tsx")];
  return candidates.some((p) => existsSync(p));
}

describe("/signal page links", () => {
  it("links only to routes that exist", () => {
    const routes = targets.filter((t) => t.startsWith("/") && !t.startsWith("/signal/"));
    expect(routes).toEqual(expect.arrayContaining(["/", "/app", "/real-signal"]));
    for (const route of routes) expect(routeExists(route), route).toBe(true);
  });

  it("points every in-page anchor at a section on the page", () => {
    const anchors = targets.filter((t) => t.startsWith("#")).map((t) => t.slice(1));
    expect(anchors.length).toBeGreaterThan(0);
    for (const id of anchors) expect(SOURCE).toContain(`id="${id}"`);
  });

  it("shows only figures that are in public/signal", () => {
    const figures = targets.filter((t) => t.startsWith("/signal/"));
    expect(figures).toHaveLength(4);
    for (const f of figures) expect(existsSync(join(ROOT, "public", f)), f).toBe(true);
  });

  it("links the report, the code and the dataset", () => {
    expect(CONSTANTS.REPORT).toBe("https://github.com/safakgungor/iamyou/blob/main/docs/signal-model.md");
    expect(CONSTANTS.CODE).toBe("https://github.com/safakgungor/iamyou/tree/main/ml/signal");
    expect(CONSTANTS.DATASET).toBe("https://doi.org/10.13026/he0v-tf17");
    expect(existsSync(join(ROOT, "docs/signal-model.md"))).toBe(true);
    expect(existsSync(join(ROOT, "ml/signal/README.md"))).toBe(true);
  });

  it("says it is not a medical device exactly once", () => {
    expect(SOURCE.match(/not a medical device/g)).toHaveLength(1);
  });
});
