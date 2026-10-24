// Feature: care-outputs, Task 8: unit tests for lib/trials-cache.ts.
//
// Covers get/set, per-condition keys and copy semantics: neither the stored
// entry nor a returned entry shares arrays with the caller.
//
// Validates: Requirements 5.4, 5.5
import { describe, expect, it } from "vitest";

import { InMemoryTrialsCache, TRIALS_CACHE_TTL_MS } from "@/lib/trials-cache";
import type { Trial } from "@/lib/trials";

const TRIAL: Trial = {
  nctId: "NCT05555555",
  title: "A Study of Memory in Adults",
  phaseLabel: "Phase 1: first tests in people",
  conditions: ["Alzheimer Disease"],
  status: "RECRUITING",
  cities: ["Boston"],
  source: "live",
};

describe("InMemoryTrialsCache", () => {
  it("holds a live result for one hour (Req 5.4)", () => {
    expect(TRIALS_CACHE_TTL_MS).toBe(3_600_000);
  });

  it("returns what was set, and undefined for an empty key", () => {
    const cache = new InMemoryTrialsCache();
    expect(cache.get("familial_alzheimers")).toBeUndefined();

    cache.set("familial_alzheimers", { trials: [TRIAL], storedAt: 1000 });
    expect(cache.get("familial_alzheimers")).toEqual({ trials: [TRIAL], storedAt: 1000 });
  });

  it("keys entries by condition", () => {
    const cache = new InMemoryTrialsCache();
    cache.set("familial_alzheimers", { trials: [TRIAL], storedAt: 1 });
    cache.set("als", { trials: [], storedAt: 2 });

    expect(cache.get("familial_alzheimers")?.trials).toHaveLength(1);
    expect(cache.get("als")).toEqual({ trials: [], storedAt: 2 });
    expect(cache.get("huntington")).toBeUndefined();

    cache.set("als", { trials: [TRIAL], storedAt: 3 });
    expect(cache.get("als")).toEqual({ trials: [TRIAL], storedAt: 3 });
  });

  it("stores and returns copies", () => {
    const cache = new InMemoryTrialsCache();
    const trials = [{ ...TRIAL, cities: ["Boston"] }];
    cache.set("huntington", { trials, storedAt: 5 });

    trials[0].cities.push("Worcester");
    trials.push({ ...TRIAL, nctId: "NCT0" });
    expect(cache.get("huntington")).toEqual({ trials: [TRIAL], storedAt: 5 });

    const returned = cache.get("huntington");
    returned?.trials[0].conditions.push("Changed");
    returned?.trials.pop();
    expect(cache.get("huntington")).toEqual({ trials: [TRIAL], storedAt: 5 });
  });
});
