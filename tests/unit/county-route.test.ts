// Feature: health-baseline, Task 16.2: unit tests for GET /api/county.
//
// These tests exercise `getCountyCard` — the testable core of the county
// route — with an `InMemoryVaultRepository` and a CSV reader passed in as a
// parameter. The Maya case reads the real CDC PLACES file through
// `readFileSync`, since the route's production reader is private.
// `findCountyCard` is wrapped in a passthrough `vi.mock` spy so one case can
// force an invalid card past the lookup and prove the schema gate returns 500
// without the unvalidated values. One handler-level test mocks
// `@/lib/db/supabase-server` to check the 401 path of `GET`.
//
// Covered behaviours:
//   - Maya (`Hampshire`) → exactly the five card values, no `population` (8.1, 8.2);
//   - `hampshire`, `null`, `''`, a missing profile, an unknown county and a
//     failed profile read → `{ available: false }` with no numbers (8.1, 8.3);
//   - a throwing reader and a row with `low > prevalence` → unavailable (8.12);
//   - a card that fails `CountyResponseSchema` → 500 `county_unavailable` (8.5, 8.13);
//   - `GET` with no user → 401, no profile read, no card values (8.4).
//
// Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.12, 8.13
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Passthrough spy: the real `findCountyCard` runs unless a test overrides it.
vi.mock("@/lib/county", async () => {
  const actual = await vi.importActual<typeof import("@/lib/county")>("@/lib/county");
  return { ...actual, findCountyCard: vi.fn(actual.findCountyCard) };
});

// The request-scoped server client needs `next/headers` and env vars; the
// handler-level test steers it per call instead.
vi.mock("@/lib/db/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { GET, getCountyCard, type CountyOutcome } from "@/app/api/county/route";
import { mayaDemoProfile } from "@/app/api/demo/start/route";
import { findCountyCard, type CountyCard } from "@/lib/county";
import { createSupabaseServerClient } from "@/lib/db/supabase-server";
import {
  InMemoryVaultRepository,
  SupabaseVaultRepository,
  type Profile,
} from "@/lib/db/vault-repository";

const mockedFindCountyCard = vi.mocked(findCountyCard);
const mockedCreateClient = vi.mocked(createSupabaseServerClient);

/* -------------------------------------------------------------------------- */
/* Fixtures & helpers                                                         */
/* -------------------------------------------------------------------------- */

const USER_ID = "user-1";
const UNAVAILABLE = { available: false };
const ERROR_BODY = { error: "county_unavailable" };

const CSV_PATH = join(process.cwd(), "data", "public", "cdc-places-short-sleep-ma-2022.csv");

/** Reads the real CDC PLACES file, as the production reader does. */
const realCsv = (): string => readFileSync(CSV_PATH, "utf-8");

/** Maya's profile (county `Hampshire`) with `overrides` applied. */
function profileWith(overrides: Partial<Profile> = {}): Profile {
  return { ...mayaDemoProfile(), ...overrides };
}

/** Seeds the profile (or none) and runs `getCountyCard` for `USER_ID`. */
async function run(profile: Profile | null, readCsv: () => string = realCsv) {
  const profiles = new InMemoryVaultRepository();
  if (profile) await profiles.upsertProfile(USER_ID, profile);
  return getCountyCard(profiles, readCsv, USER_ID);
}

/** Asserts the 200 unavailable outcome, which carries no numbers. */
function expectUnavailable(outcome: CountyOutcome): void {
  expect(outcome.status).toBe(200);
  expect(outcome.body).toStrictEqual(UNAVAILABLE);
  expect(JSON.stringify(outcome.body)).toBe('{"available":false}');
  for (const key of ["card", "prevalence", "low", "high", "population"]) {
    expect(outcome.body).not.toHaveProperty(key);
  }
}

/** Profile repository whose read always fails. */
class FailingProfileRepository extends InMemoryVaultRepository {
  override async getProfile(): Promise<Profile | null> {
    throw new Error("profiles read failed");
  }
}

beforeEach(() => {
  vi.clearAllMocks();
});

/* -------------------------------------------------------------------------- */
/* Card values (Req 8.1, 8.2)                                                 */
/* -------------------------------------------------------------------------- */

describe("getCountyCard — card", () => {
  it("Maya (Hampshire) → exactly the five values from the real CSV, no population (Req 8.1, 8.2)", async () => {
    expect(mayaDemoProfile().county).toBe("Hampshire");
    const outcome = await run(profileWith());
    expect(outcome.status).toBe(200);
    expect(outcome.body).toStrictEqual({
      available: true,
      card: { county: "Hampshire", year: 2022, prevalence: 31.5, low: 26.8, high: 36.4 },
    });
    const card = (outcome.body as { card: CountyCard }).card;
    expect(Object.keys(card).sort()).toEqual(["county", "high", "low", "prevalence", "year"]);
    expect(card).not.toHaveProperty("population");
    expect(JSON.stringify(outcome.body)).not.toContain("162502");
  });
});

/* -------------------------------------------------------------------------- */
/* Unavailable (Req 8.1, 8.3, 8.12)                                           */
/* -------------------------------------------------------------------------- */

describe("getCountyCard — unavailable", () => {
  it.each<[string, Profile | null]>([
    ["lower-case 'hampshire' (case-sensitive match)", profileWith({ county: "hampshire" })],
    ["null county", profileWith({ county: null })],
    ["empty-string county", profileWith({ county: "" })],
    ["missing profile", null],
    ["unknown county", profileWith({ county: "Atlantis" })],
  ])("%s → { available: false } (Req 8.1, 8.3)", async (_label, profile) => {
    expectUnavailable(await run(profile));
  });

  it("a failed profile read → { available: false }", async () => {
    const outcome = await getCountyCard(new FailingProfileRepository(), realCsv, USER_ID);
    expectUnavailable(outcome);
  });

  it("a throwing CSV reader → { available: false } (Req 8.12)", async () => {
    const outcome = await run(profileWith(), () => {
      throw new Error("ENOENT");
    });
    expectUnavailable(outcome);
  });

  it("a matching row with low > prevalence → { available: false }, no row values (Req 8.12)", async () => {
    const csv = "year,county,prevalence,low,high,population\n2022,Hampshire,31.5,33.3,36.4,162502\n";
    const outcome = await run(profileWith(), () => csv);
    expectUnavailable(outcome);
    expect(JSON.stringify(outcome.body)).not.toMatch(/31\.5|33\.3|36\.4|162502/);
  });
});

/* -------------------------------------------------------------------------- */
/* Schema gate (Req 8.5, 8.13)                                                */
/* -------------------------------------------------------------------------- */

describe("getCountyCard — schema gate", () => {
  it.each<[string, unknown]>([
    ["prevalence 150", { county: "Hampshire", year: 2022, prevalence: 150, low: 26.8, high: 36.4 }],
    [
      "an extra population key",
      { county: "Hampshire", year: 2022, prevalence: 31.5, low: 26.8, high: 36.4, population: 162502 },
    ],
  ])("a card forced past the lookup with %s → 500 county_unavailable, no values (Req 8.5, 8.13)", async (_label, card) => {
    mockedFindCountyCard.mockReturnValueOnce(card as CountyCard);
    const outcome = await run(profileWith());
    expect(mockedFindCountyCard).toHaveBeenCalledTimes(1);
    expect(outcome.status).toBe(500);
    expect(outcome.body).toStrictEqual(ERROR_BODY);
    const json = JSON.stringify(outcome.body);
    expect(json).toBe('{"error":"county_unavailable"}');
    expect(json).not.toMatch(/150|31\.5|26\.8|36\.4|162502|Hampshire/);
  });
});

/* -------------------------------------------------------------------------- */
/* Handler (Req 8.4)                                                          */
/* -------------------------------------------------------------------------- */

describe("GET /api/county — handler", () => {
  it("no user → 401 with no card values, and no profile read (Req 8.4)", async () => {
    const from = vi.fn();
    mockedCreateClient.mockResolvedValueOnce({
      auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: null })) },
      from,
    } as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>);
    const getProfile = vi.spyOn(SupabaseVaultRepository.prototype, "getProfile");

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(401);
    for (const key of ["available", "card", "county", "prevalence", "low", "high", "population"]) {
      expect(body).not.toHaveProperty(key);
    }
    expect(getProfile).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
    expect(mockedFindCountyCard).not.toHaveBeenCalled();
    getProfile.mockRestore();
  });
});
