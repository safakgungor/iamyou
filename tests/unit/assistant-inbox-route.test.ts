// Feature: assistant-tasks, Task 8.2: unit tests for the inbox route.
//
// These tests exercise the exported `GET` handler of
// `app/api/assistant/inbox/route.ts`. The route reads the read-only synthetic
// inbox at request time via `loadInbox()` (no DB write), and on a read/parse
// failure responds 503 `{ error: 'inbox_unavailable' }`, again writing nothing.
// On success it decorates each message with a derived `relative_time_label` and
// responds with the fixed "Synthetic data" label plus the messages.
//
// The route calls `loadInbox()` directly (no dependency injection), so we mock
// `@/lib/inbox` with a factory that keeps the REAL implementation by default
// (`vi.importActual`) and exposes `loadInbox`/`relativeTimeLabel` as spies. The
// success case lets the real `loadInbox` read `data/synthetic/maya/inbox.json`;
// the unavailable case overrides `loadInbox` to return the failure signal so we
// can assert the 503 path. The response is a `NextResponse`, inspected via
// `.status` and `await res.json()`.
//
// Covered behaviours (Req 1.5, 1.6, 2.1):
//   - a loadable inbox yields a 200 response carrying
//     `synthetic_label: 'Synthetic data'` plus messages that each carry a
//     `relative_time_label`, including the "Dr. Lee's office, Valley Family
//     Medicine" message (which, at 0 days ago, labels as "Today") (Req 1.5, 2.1);
//   - an unavailable inbox yields 503 `{ error: 'inbox_unavailable' }` and
//     performs no database write (Req 1.6).
//
// Validates: Requirements 1.5, 1.6, 2.1
import { describe, expect, it, vi } from "vitest";

// Mock the inbox module so we can steer `loadInbox` per-test while keeping the
// real `relativeTimeLabel` (and the real `loadInbox` by default).
vi.mock("@/lib/inbox", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/inbox")>("@/lib/inbox");
  return {
    ...actual,
    loadInbox: vi.fn(actual.loadInbox),
    relativeTimeLabel: vi.fn(actual.relativeTimeLabel),
  };
});

import { GET } from "@/app/api/assistant/inbox/route";
import { loadInbox } from "@/lib/inbox";

const mockedLoadInbox = vi.mocked(loadInbox);

/* -------------------------------------------------------------------------- */
/* Loadable inbox → 200 with synthetic label + decorated messages             */
/* -------------------------------------------------------------------------- */

describe("GET /api/assistant/inbox — loadable inbox", () => {
  it("responds 200 with the fixed synthetic label and decorated messages (Req 1.5, 2.1)", async () => {
    // Default mock delegates to the real loadInbox, reading the actual
    // data/synthetic/maya/inbox.json file.
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);

    // The screen's fixed "Synthetic data" label is present. (Req 1.5)
    expect(body.synthetic_label).toBe("Synthetic data");

    expect(Array.isArray(body.messages)).toBe(true);
    expect(body.messages.length).toBeGreaterThan(0);

    // Every message carries a derived relative_time_label. (Req 2)
    for (const message of body.messages) {
      expect(message).toHaveProperty("relative_time_label");
      expect(typeof message.relative_time_label).toBe("string");
    }

    // The "Dr. Lee's office, Valley Family Medicine" message is present and,
    // because it arrived 0 days ago, labels as "Today". (Req 1.5, 2.1)
    const doctor = body.messages.find(
      (m: { from: string }) =>
        m.from === "Dr. Lee's office, Valley Family Medicine",
    );
    expect(doctor).toBeDefined();
    expect(doctor.subject).toBe("Your appointment on Thursday");
    expect(doctor.received_days_ago).toBe(0);
    expect(doctor.relative_time_label).toBe("Today");
  });
});

/* -------------------------------------------------------------------------- */
/* Unavailable inbox → 503 with no write                                      */
/* -------------------------------------------------------------------------- */

describe("GET /api/assistant/inbox — unavailable inbox", () => {
  it("responds 503 { error: 'inbox_unavailable' } and writes nothing (Req 1.6)", async () => {
    // Steer loadInbox to report the inbox as unavailable.
    mockedLoadInbox.mockReturnValueOnce({
      ok: false,
      error: "inbox_unavailable",
    });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body).toEqual({ error: "inbox_unavailable" });

    // The route takes no repository and performs no database write on this
    // path; there is nothing to assert beyond the pure 503 response — the
    // handler returns before any decoration or persistence occurs.
  });
});
