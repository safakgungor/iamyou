// Feature: assistant-tasks, Task 2.2: unit tests for `loadInbox` and
// `relativeTimeLabel`.
//
// These tests exercise the read-only synthetic inbox module in `lib/inbox.ts`.
// `loadInbox` reads and parses `data/synthetic/maya/inbox.json` at request time
// and returns every message, performing no database write; on a read or parse
// failure it returns `{ ok: false, error: 'inbox_unavailable' }`.
// `relativeTimeLabel` is a pure total string function over `received_days_ago`.
//
// Covered behaviours (Req 1.1, 1.4, 1.6, 2.1–2.4):
//   - the default-path load returns ALL messages, including the
//     "Dr. Lee's office, Valley Family Medicine" appointment message (Req 1.1,
//     1.4);
//   - a missing file and a corrupt (invalid-JSON) file each return
//     `{ ok: false, error: 'inbox_unavailable' }` (Req 1.6);
//   - the `relativeTimeLabel` boundaries 0, 1, 2, 3650, 3651, -1, null, and a
//     non-integer all render as specified (Req 2.1–2.4).
//
// Validates: Requirements 1.1, 1.4, 1.6, 2.1, 2.2, 2.3, 2.4
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadInbox, relativeTimeLabel } from "@/lib/inbox";

/* -------------------------------------------------------------------------- */
/* Temp-file bookkeeping                                                      */
/* -------------------------------------------------------------------------- */

/** Temp directories created during the run, removed in `afterEach`. */
const tempDirs: string[] = [];

/** Create a temp file containing `contents` and return its absolute path. */
function writeTempFile(name: string, contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "inbox-test-"));
  tempDirs.push(dir);
  const filePath = join(dir, name);
  writeFileSync(filePath, contents, "utf8");
  return filePath;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

/* -------------------------------------------------------------------------- */
/* loadInbox                                                                  */
/* -------------------------------------------------------------------------- */

describe("loadInbox", () => {
  it("returns all messages including the doctor's-office message (Req 1.1, 1.4)", () => {
    const result = loadInbox();

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Every message is read-only synthetic data.
    expect(result.messages.length).toBeGreaterThan(0);
    for (const message of result.messages) {
      expect(message.synthetic).toBe(true);
    }

    const doctor = result.messages.find(
      (m) => m.from === "Dr. Lee's office, Valley Family Medicine",
    );
    expect(doctor).toBeDefined();
    expect(doctor?.subject).toBe("Your appointment on Thursday");
  });

  it("returns inbox_unavailable on a missing file (Req 1.6)", () => {
    const missingPath = join(
      tmpdir(),
      "inbox-test-does-not-exist",
      "inbox.json",
    );

    expect(loadInbox(missingPath)).toEqual({
      ok: false,
      error: "inbox_unavailable",
    });
  });

  it("returns inbox_unavailable on a corrupt (invalid-JSON) file (Req 1.6)", () => {
    const corruptPath = writeTempFile("inbox.json", "{ not valid json ]]]");

    expect(loadInbox(corruptPath)).toEqual({
      ok: false,
      error: "inbox_unavailable",
    });
  });
});

/* -------------------------------------------------------------------------- */
/* relativeTimeLabel                                                          */
/* -------------------------------------------------------------------------- */

describe("relativeTimeLabel", () => {
  it("renders 0 as 'Today' (Req 2.1)", () => {
    expect(relativeTimeLabel(0)).toBe("Today");
  });

  it("renders 1 as '1 day ago' (Req 2.2)", () => {
    expect(relativeTimeLabel(1)).toBe("1 day ago");
  });

  it("renders 2 as '2 days ago' (Req 2.3)", () => {
    expect(relativeTimeLabel(2)).toBe("2 days ago");
  });

  it("renders the 3650 boundary as '3650 days ago' (Req 2.3)", () => {
    expect(relativeTimeLabel(3650)).toBe("3650 days ago");
  });

  it("renders just past the boundary (3651) as the empty string (Req 2.4)", () => {
    expect(relativeTimeLabel(3651)).toBe("");
  });

  it("renders a negative value (-1) as the empty string (Req 2.4)", () => {
    expect(relativeTimeLabel(-1)).toBe("");
  });

  it("renders null as the empty string (Req 2.4)", () => {
    expect(relativeTimeLabel(null)).toBe("");
  });

  it("renders a non-integer (1.5) as the empty string (Req 2.4)", () => {
    expect(relativeTimeLabel(1.5)).toBe("");
  });
});
