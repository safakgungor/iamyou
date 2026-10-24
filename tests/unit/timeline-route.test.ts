// Feature: health-baseline, Task 15.3: unit tests for GET /api/timeline.
//
// These tests exercise `getTimeline` — the repository-backed core of the
// timeline route — with `countingWeeklyRepo` over an
// `InMemoryWeeklyFeatureRepository` and an `InMemoryVaultRepository`, so every
// case can assert how often `listWeeklyFeatures` ran. `buildTimeline` (the only
// path to `detectSignal`) is wrapped in a passthrough `vi.mock` spy so the
// opted-out cases can prove it never ran. One handler-level test mocks
// `@/lib/db/supabase-server` to check the 401 path of `GET`.
//
// Covered behaviours (design "timeline-route.test.ts", D11):
//   - no profile / `healthLayerOptIn: false` → 200 and exactly
//     `{"opted_in":false}`, no weekly read, no `buildTimeline` call (9.1, 9.2, 9.7);
//   - a failed profile read → 503 with no `opted_in` key and no weekly read (7.16);
//   - opted in → `opted_in` first, only the caller's rows, sorted; Maya's
//     history with `tell_me` carries a signal (7.1, 9.3);
//   - any other `rtk_setting` → `signal: null`, otherwise identical JSON (7.3, 7.4);
//   - zero rows → the empty result (7.15); a failed weekly read or an invalid
//     `weekStart` → 503 with no data (7.6, 7.16);
//   - `TimelineResponseSchema` is a strict discriminated union (9.4);
//   - `GET` with no user → 401, no profile read (7.5).
//
// Validates: Requirements 7.1, 7.3, 7.4, 7.5, 7.6, 7.15, 7.16, 9.1, 9.2, 9.3, 9.4, 9.7
import { beforeEach, describe, expect, it, vi } from "vitest";

// Passthrough spy: the real `buildTimeline` runs, but calls are recorded.
vi.mock("@/lib/timeline", async () => {
  const actual = await vi.importActual<typeof import("@/lib/timeline")>("@/lib/timeline");
  return { ...actual, buildTimeline: vi.fn(actual.buildTimeline) };
});

// The request-scoped server client needs `next/headers` and env vars; the
// handler-level test steers it per call instead.
vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { GET, getTimeline, type TimelineOutcome } from "@/app/api/timeline/route";
import { mayaDemoProfile, mayaDemoWeeklyFeatures } from "@/app/api/demo/start/route";
import { buildTimeline } from "@/lib/timeline";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import {
  InMemoryVaultRepository,
  SupabaseVaultRepository,
  type Profile,
} from "@/lib/db/vault-repository";
import {
  InMemoryWeeklyFeatureRepository,
  SupabaseWeeklyFeatureRepository,
} from "@/lib/db/weekly-feature-repository";
import { FEATURES, type WeeklyFeatureRow } from "@/lib/baseline";
import { TimelineResponseSchema } from "@/lib/claude/schemas";
import type { TimelineOptedIn } from "@/lib/api-schemas";
import { countingWeeklyRepo } from "../pbt/helpers/weekly-rows";

const mockedBuildTimeline = vi.mocked(buildTimeline);
const mockedCreateClient = vi.mocked(createSupabaseServerClient);

/* -------------------------------------------------------------------------- */
/* Fixtures & helpers                                                         */
/* -------------------------------------------------------------------------- */

const USER_ID = "user-1";
const OTHER_USER_ID = "user-2";
const UNAVAILABLE_BODY = { error: "timeline_unavailable" };

/** Maya's 1,149 synthetic weeks, built once (the JSON is large). */
const MAYA_ROWS = mayaDemoWeeklyFeatures();

/** Maya's profile (opted in, `tell_me`) with `overrides` applied. */
function profileWith(overrides: Partial<Profile> = {}): Profile {
  return { ...mayaDemoProfile(), ...overrides };
}

/** A stored row with every feature set to `value`. */
function row(weekStart: string, value: number, synthetic = true): WeeklyFeatureRow {
  const out = { weekStart, synthetic } as WeeklyFeatureRow;
  for (const f of FEATURES) out[f] = value;
  return out;
}

/** Seeds the repositories and runs `getTimeline` for `USER_ID`. */
async function run(opts: {
  profile?: Profile | null;
  rows?: readonly WeeklyFeatureRow[];
  otherRows?: readonly WeeklyFeatureRow[];
}) {
  const inner = new InMemoryWeeklyFeatureRepository();
  if (opts.rows) await inner.upsertWeeklyFeatures(USER_ID, opts.rows);
  if (opts.otherRows) await inner.upsertWeeklyFeatures(OTHER_USER_ID, opts.otherRows);
  const weekly = countingWeeklyRepo(inner);

  const profiles = new InMemoryVaultRepository();
  if (opts.profile) await profiles.upsertProfile(USER_ID, opts.profile);

  const outcome = await getTimeline(weekly, profiles, USER_ID);
  return { outcome, weekly };
}

/** Asserts a 200 opted-in outcome and returns its typed body. */
function optedInBody(outcome: TimelineOutcome): TimelineOptedIn {
  expect(outcome.status).toBe(200);
  const body = outcome.body as TimelineOptedIn;
  expect(body.opted_in).toBe(true);
  return body;
}

/** No timeline data of any kind is present in `body`. */
function expectNoData(body: unknown): void {
  for (const key of ["opted_in", "rtk_setting", "rows", "z_scores", "baseline", "signal"]) {
    expect(body).not.toHaveProperty(key);
  }
}

/** Profile repository whose read always fails. */
class FailingProfileRepository extends InMemoryVaultRepository {
  override async getProfile(): Promise<Profile | null> {
    throw new Error("profiles read failed");
  }
}

/** Weekly repository whose list always fails. */
class FailingWeeklyRepository extends InMemoryWeeklyFeatureRepository {
  override async listWeeklyFeatures(): Promise<WeeklyFeatureRow[]> {
    throw new Error("weekly_features read failed");
  }
}

beforeEach(() => {
  vi.clearAllMocks();
});

/* -------------------------------------------------------------------------- */
/* Opted out (Req 9.1, 9.2, 9.7)                                              */
/* -------------------------------------------------------------------------- */

describe("getTimeline — opted out", () => {
  it("(a) no profile → 200 exactly {\"opted_in\":false}, no weekly read, no buildTimeline (Req 9.1, 9.2, 9.7)", async () => {
    const { outcome, weekly } = await run({ profile: null, rows: MAYA_ROWS });

    expect(outcome.status).toBe(200);
    expect(outcome.body).toStrictEqual({ opted_in: false });
    expect(JSON.stringify(outcome.body)).toBe('{"opted_in":false}');
    expect(weekly.listCalls).toBe(0);
    expect(mockedBuildTimeline).not.toHaveBeenCalled();
  });

  it("(b) healthLayerOptIn false with Maya's 1,149 rows seeded → exactly {\"opted_in\":false}, no weekly read (Req 9.1, 9.2, 9.7)", async () => {
    expect(MAYA_ROWS).toHaveLength(1149);
    const { outcome, weekly } = await run({
      profile: profileWith({ healthLayerOptIn: false }), // rtk_setting stays tell_me
      rows: MAYA_ROWS,
    });

    expect(outcome.status).toBe(200);
    expect(outcome.body).toStrictEqual({ opted_in: false });
    expect(JSON.stringify(outcome.body)).toBe('{"opted_in":false}');
    expect(weekly.listCalls).toBe(0);
    expect(mockedBuildTimeline).not.toHaveBeenCalled();
  });

  it("(c) profile read throws → 503 timeline_unavailable, no opted_in key, no weekly read (Req 7.16)", async () => {
    const inner = new InMemoryWeeklyFeatureRepository();
    await inner.upsertWeeklyFeatures(USER_ID, MAYA_ROWS);
    const weekly = countingWeeklyRepo(inner);

    const outcome = await getTimeline(weekly, new FailingProfileRepository(), USER_ID);

    expect(outcome.status).toBe(503);
    expect(outcome.body).toStrictEqual(UNAVAILABLE_BODY);
    expectNoData(outcome.body);
    expect(weekly.listCalls).toBe(0);
    expect(mockedBuildTimeline).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* Opted in (Req 7.1, 7.3, 7.4, 9.3)                                          */
/* -------------------------------------------------------------------------- */

describe("getTimeline — opted in", () => {
  it("(d) opted_in is the first key and only the caller's rows return, sorted (Req 7.1, 9.3)", async () => {
    // Caller's rows inserted out of order; another user has rows in between.
    const mine = [row("2024-01-15", 3), row("2024-01-01", 1), row("2024-01-08", 2)];
    const theirs = [row("2024-01-04", 90, false), row("2024-01-11", 91, false)];

    const { outcome, weekly } = await run({ profile: profileWith(), rows: mine, otherRows: theirs });
    const body = optedInBody(outcome);

    expect(Object.keys(body)[0]).toBe("opted_in");
    expect(JSON.stringify(body).startsWith('{"opted_in":true,')).toBe(true);
    expect(body.rows.map((r) => r.week_start)).toEqual(["2024-01-01", "2024-01-08", "2024-01-15"]);
    expect(body.rows.map((r) => r.vocabulary_diversity)).toEqual([1, 2, 3]);
    expect(body.rows.every((r) => r.synthetic === true)).toBe(true);
    expect(body.z_scores.map((z) => z.week_start)).toEqual(["2024-01-01", "2024-01-08", "2024-01-15"]);
    expect(weekly.listCalls).toBe(1);
    expect(mockedBuildTimeline).toHaveBeenCalledTimes(1);
  });

  it("(d) Maya's seeded history with tell_me includes a signal (Req 7.3)", async () => {
    const { outcome } = await run({ profile: profileWith({ rtkSetting: "tell_me" }), rows: MAYA_ROWS });
    const body = optedInBody(outcome);

    expect(body.rtk_setting).toBe("tell_me");
    expect(body.rows).toHaveLength(1149);
    expect(body.signal).not.toBeNull();
    expect(body.signal!.features.length).toBeGreaterThan(0);
    expect(body.signal!.first_week).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("gated settings give signal: null with otherwise identical JSON (Req 7.3, 7.4)", async () => {
    const shown = optedInBody(
      (await run({ profile: profileWith({ rtkSetting: "tell_me" }), rows: MAYA_ROWS })).outcome
    );
    expect(shown.signal).not.toBeNull();

    // Valid settings are echoed; null and an invalid value become null.
    const cases: Array<{ setting: unknown; echoed: TimelineOptedIn["rtk_setting"] }> = [
      { setting: "doctor_only", echoed: "doctor_only" },
      { setting: "record_only", echoed: "record_only" },
      { setting: null, echoed: null },
      { setting: "TELL_ME", echoed: null },
    ];

    for (const { setting, echoed } of cases) {
      const profile = profileWith({ rtkSetting: setting as Profile["rtkSetting"] });
      const body = optedInBody((await run({ profile, rows: MAYA_ROWS })).outcome);

      expect(body.signal).toBeNull();
      const expected = { ...shown, rtk_setting: echoed, signal: null };
      expect(JSON.stringify(body)).toBe(JSON.stringify(expected));
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Edges (Req 7.6, 7.15, 7.16)                                                */
/* -------------------------------------------------------------------------- */

describe("getTimeline — edges", () => {
  it("a throwing weekly repo → 503 with no data (Req 7.16)", async () => {
    const weekly = countingWeeklyRepo(new FailingWeeklyRepository());
    const profiles = new InMemoryVaultRepository();
    await profiles.upsertProfile(USER_ID, profileWith());

    const outcome = await getTimeline(weekly, profiles, USER_ID);

    expect(outcome.status).toBe(503);
    expect(outcome.body).toStrictEqual(UNAVAILABLE_BODY);
    expectNoData(outcome.body);
    expect(weekly.listCalls).toBe(1);
    expect(mockedBuildTimeline).not.toHaveBeenCalled();
  });

  it("opted in with zero rows → the empty result (Req 7.15)", async () => {
    const { outcome, weekly } = await run({ profile: profileWith(), otherRows: [row("2024-01-01", 5)] });
    const body = optedInBody(outcome);

    expect(body.rows).toEqual([]);
    expect(body.z_scores).toEqual([]);
    for (const f of FEATURES) expect(body.baseline[f]).toBeNull();
    expect(Object.keys(body.baseline).sort()).toEqual([...FEATURES].sort());
    expect(body.signal).toBeNull();
    expect(weekly.listCalls).toBe(1);
  });

  it("a row with an invalid weekStart → 503 with no data (Req 7.6)", async () => {
    const rows = [row("2024-01-01", 1), row("2024/01/08", 2)];
    const { outcome } = await run({ profile: profileWith(), rows });

    expect(outcome.status).toBe(503);
    expect(outcome.body).toStrictEqual(UNAVAILABLE_BODY);
    expectNoData(outcome.body);
  });
});

/* -------------------------------------------------------------------------- */
/* Schema (Req 9.4)                                                           */
/* -------------------------------------------------------------------------- */

describe("TimelineResponseSchema — opted-out branch", () => {
  it("accepts { opted_in: false } and rejects extra keys (Req 9.4)", () => {
    expect(TimelineResponseSchema.safeParse({ opted_in: false }).success).toBe(true);
    expect(TimelineResponseSchema.safeParse({ opted_in: false, rows: [] }).success).toBe(false);
    expect(TimelineResponseSchema.safeParse({ opted_in: false, signal: null }).success).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Handler (Req 7.5)                                                          */
/* -------------------------------------------------------------------------- */

describe("GET /api/timeline — handler", () => {
  it("no user → 401 with no data, and no profile or weekly read (Req 7.5)", async () => {
    const from = vi.fn();
    mockedCreateClient.mockResolvedValueOnce({
      auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: null })) },
      from,
    } as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>);
    const getProfile = vi.spyOn(SupabaseVaultRepository.prototype, "getProfile");
    const listWeekly = vi.spyOn(SupabaseWeeklyFeatureRepository.prototype, "listWeeklyFeatures");

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(401);
    expectNoData(body);
    expect(getProfile).not.toHaveBeenCalled();
    expect(listWeekly).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
    expect(mockedBuildTimeline).not.toHaveBeenCalled();

    getProfile.mockRestore();
    listWeekly.mockRestore();
  });
});
