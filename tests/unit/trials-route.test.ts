// Feature: care-outputs, Task 10.2: unit tests for GET /api/trials.
//
// `getTrials` runs against an in-memory vault, an in-memory cache, a fake
// `fetchLiveStudies`, a fake slice reader and a fake clock, so no test reaches
// ClinicalTrials.gov, Supabase or the file system. The default
// `fetchLiveStudies` is checked against a stubbed global `fetch`.
//
// Validates: Requirements 5.1, 5.3, 5.4, 5.5, 5.6, 5.7, 6.1, 6.3, 6.4, 6.5
import { afterEach, describe, expect, it, vi } from "vitest";

import { mayaDemoProfile } from "@/app/api/demo/start/route";
import { fetchLiveStudies, getTrials, type TrialsDeps } from "@/app/api/trials/route";
import { InMemoryVaultRepository, type Profile } from "@/lib/db/vault-repository";
import { InMemoryTrialsCache, TRIALS_CACHE_TTL_MS } from "@/lib/trials-cache";
import type { Trial } from "@/lib/trials";

const USER_ID = "user-1";
const SEARCH_URL =
  "https://clinicaltrials.gov/search?cond=Alzheimer%20Disease&aggFilters=status:rec&country=United%20States&state=Massachusetts&locStr=Massachusetts";

function study(nctId: string, state: string, status = "RECRUITING"): unknown {
  return {
    protocolSection: {
      identificationModule: { nctId, briefTitle: `Study ${nctId}` },
      statusModule: { overallStatus: status },
      conditionsModule: { conditions: ["Alzheimer Disease"] },
      designModule: { phases: ["PHASE2"] },
      contactsLocationsModule: { locations: [{ city: "Boston", state }] },
    },
  };
}

const SLICE =
  "nct_id,title,phase,conditions,massachusetts_city,status\n" +
  'NCT1,"Memory, Mood and Sleep",PHASE1,Alzheimer Disease,,RECRUITING\n' +
  "NCT2,Heart Study,NA,Heart Failure,,RECRUITING\n" +
  "NCT3,Movement Study,,Huntington Disease,,RECRUITING\n";

const CACHED: Trial = {
  nctId: "NCT_CACHED",
  title: "Cached study",
  phaseLabel: "Phase 1: first tests in people",
  conditions: ["Alzheimer Disease"],
  status: "RECRUITING",
  cities: ["Boston"],
  source: "live",
};

async function setup(
  overrides: Partial<TrialsDeps> = {},
  profile: Profile | null = mayaDemoProfile(),
) {
  const vault = new InMemoryVaultRepository();
  if (profile) await vault.upsertProfile(USER_ID, profile);
  let clock = 1_000_000;
  const fetchLive = vi.fn(async () => ({ studies: [study("NCT_MA", "Massachusetts"), study("NCT_NY", "New York")] }));
  const readSlice = vi.fn(async () => SLICE);
  const deps: TrialsDeps = {
    vault,
    cache: new InMemoryTrialsCache(),
    fetchLiveStudies: fetchLive,
    readSlice,
    now: () => clock,
    timeoutMs: 20,
    ...overrides,
  };
  return { deps, fetchLive, readSlice, advance: (ms: number) => (clock += ms) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchLiveStudies", () => {
  it("requests Alzheimer Disease, Massachusetts, RECRUITING and the six fields (Req 5.1)", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ studies: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchLiveStudies("familial_alzheimers", new AbortController().signal)).resolves.toEqual({
      studies: [],
    });

    const url = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]));
    expect(`${url.origin}${url.pathname}`).toBe("https://clinicaltrials.gov/api/v2/studies");
    expect(url.searchParams.get("query.cond")).toBe("Alzheimer Disease");
    expect(url.searchParams.get("query.locn")).toBe("Massachusetts");
    expect(url.searchParams.get("filter.overallStatus")).toBe("RECRUITING");
    expect(url.searchParams.get("fields")).toBe(
      "NCTId,BriefTitle,OverallStatus,Condition,Phase,LocationCity,LocationState",
    );
    expect(url.searchParams.get("pageSize")).toBe("100");
  });

  it("throws on a non-2xx status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    await expect(fetchLiveStudies("als", new AbortController().signal)).rejects.toThrow();
  });
});

describe("getTrials", () => {
  it("passes Maya's family condition to the live fetch", async () => {
    const { deps, fetchLive } = await setup();
    await getTrials(deps, USER_ID);
    expect(fetchLive).toHaveBeenCalledTimes(1);
    expect((fetchLive.mock.calls[0] as unknown[])[0]).toBe("familial_alzheimers");
  });

  it("returns 404 without a profile", async () => {
    const { deps, fetchLive } = await setup({}, null);
    expect(await getTrials(deps, USER_ID)).toEqual({ status: 404, body: { error: "Profile not found" } });
    expect(fetchLive).not.toHaveBeenCalled();
  });

  it.each(["none", "prefer_not", undefined])(
    "makes no request for family history %j (Req 5.3)",
    async (familyHistory) => {
      const profile = { ...mayaDemoProfile(), familyHistory } as Profile;
      const { deps, fetchLive, readSlice } = await setup({}, profile);
      expect(await getTrials(deps, USER_ID)).toEqual({
        status: 200,
        body: { status: "no_family_condition", trials: [] },
      });
      expect(fetchLive).not.toHaveBeenCalled();
      expect(readSlice).not.toHaveBeenCalled();
    },
  );

  it("serves live trials without non-Massachusetts studies and caches them (Req 5.4)", async () => {
    const { deps } = await setup();
    const outcome = await getTrials(deps, USER_ID);

    expect(outcome.status).toBe(200);
    expect(outcome.body).toMatchObject({ status: "ok", origin: "live", search_url: SEARCH_URL });
    const trials = (outcome.body as { trials: Trial[] }).trials;
    expect(trials.map((t) => t.nctId)).toEqual(["NCT_MA"]);
    expect(trials[0]).toMatchObject({ cities: ["Boston"], source: "live", status: "RECRUITING" });
    expect(deps.cache.get("familial_alzheimers")).toEqual({ trials, storedAt: 1_000_000 });
  });

  it("serves a cache hit under 3600 s without a request, and fetches again at 3600 s (Req 5.5)", async () => {
    const { deps, fetchLive, advance } = await setup();
    deps.cache.set("familial_alzheimers", { trials: [CACHED], storedAt: 1_000_000 });

    advance(TRIALS_CACHE_TTL_MS - 1);
    const hit = await getTrials(deps, USER_ID);
    expect(hit.body).toMatchObject({ status: "ok", origin: "cache", trials: [CACHED] });
    expect(fetchLive).not.toHaveBeenCalled();

    advance(1);
    const refreshed = await getTrials(deps, USER_ID);
    expect(refreshed.body).toMatchObject({ status: "ok", origin: "live" });
    expect(fetchLive).toHaveBeenCalledTimes(1);
  });

  it("returns no_matches with the exact text when the live API finds nothing (Req 5.7)", async () => {
    const { deps } = await setup({ fetchLiveStudies: async () => ({ studies: [] }) });
    expect(await getTrials(deps, USER_ID)).toEqual({
      status: 200,
      body: {
        status: "no_matches",
        trials: [],
        message: "No matching studies recruiting in Massachusetts right now.",
        search_url: SEARCH_URL,
      },
    });
  });

  it.each([
    ["an error", async () => Promise.reject(new Error("network down"))],
    ["a timeout", () => new Promise<unknown>(() => {})],
    ["a bad shape", async () => ({ results: [] })],
  ])("serves a stale cache entry on %s (Req 5.6)", async (_label, fetchLiveStudies) => {
    const { deps, readSlice, advance } = await setup({ fetchLiveStudies });
    deps.cache.set("familial_alzheimers", { trials: [CACHED], storedAt: 1_000_000 });
    advance(TRIALS_CACHE_TTL_MS * 5);

    const outcome = await getTrials(deps, USER_ID);
    expect(outcome.body).toMatchObject({ status: "ok", origin: "stale_cache", trials: [CACHED] });
    expect(readSlice).not.toHaveBeenCalled();
  });

  it("aborts the live request when the timeout fires", async () => {
    let seen: AbortSignal | undefined;
    const { deps } = await setup({
      fetchLiveStudies: (_condition, signal) => {
        seen = signal;
        return new Promise<unknown>(() => {});
      },
    });
    await getTrials(deps, USER_ID);
    expect(seen?.aborted).toBe(true);
  });

  it.each([
    ["an error", async () => Promise.reject(new Error("network down"))],
    ["a timeout", () => new Promise<unknown>(() => {})],
  ])("falls back to the matching slice rows on %s without a cache (Req 6.1, 6.3, 6.4)", async (_label, fetchLiveStudies) => {
    const { deps } = await setup({ fetchLiveStudies });
    const outcome = await getTrials(deps, USER_ID);

    expect(outcome.body).toMatchObject({ status: "ok", origin: "saved_ma_slice", search_url: SEARCH_URL });
    expect((outcome.body as { trials: Trial[] }).trials).toEqual([
      {
        nctId: "NCT1",
        title: "Memory, Mood and Sleep",
        phaseLabel: "Phase 1: first tests in people",
        conditions: ["Alzheimer Disease"],
        status: "RECRUITING",
        cities: ["Massachusetts"],
        source: "saved_ma_slice",
      },
    ]);
    // A failed live request is never cached.
    expect(deps.cache.get("familial_alzheimers")).toBeUndefined();
  });

  it("returns no_matches with the search URL when no slice row matches (Req 6.5)", async () => {
    const profile = { ...mayaDemoProfile(), familyHistory: "als" } as Profile;
    const { deps } = await setup({ fetchLiveStudies: async () => Promise.reject(new Error("down")) }, profile);

    expect(await getTrials(deps, USER_ID)).toEqual({
      status: 200,
      body: {
        status: "no_matches",
        trials: [],
        message: "No matching studies recruiting in Massachusetts right now.",
        search_url:
          "https://clinicaltrials.gov/search?cond=Amyotrophic%20Lateral%20Sclerosis&aggFilters=status:rec&country=United%20States&state=Massachusetts&locStr=Massachusetts",
      },
    });
  });

  it("returns 503 when the slice cannot be read and nothing is cached (Req 6.1)", async () => {
    const { deps } = await setup({
      fetchLiveStudies: async () => Promise.reject(new Error("down")),
      readSlice: async () => Promise.reject(new Error("ENOENT")),
    });
    expect(await getTrials(deps, USER_ID)).toEqual({ status: 503, body: { error: "trials_unavailable" } });
  });
});
