// Feature: care-outputs, Task 11.2: unit tests for POST /api/summary.
//
// `getSummary` runs against in-memory vault and weekly feature repositories
// seeded with Maya's synthetic profile and history, so no test reaches
// Supabase. No model is involved anywhere in this route.
//
// Validates: Requirements 1.2, 3.2, 4.2, 4.4
import { describe, expect, it, vi } from "vitest";

import mayaWeekly from "@/data/synthetic/maya/weekly-features.json";
import { mayaDemoProfile } from "@/app/api/demo/start/route";
import { getSummary } from "@/app/api/summary/route";
import { computeBaseline, recentMean, zScores, type WeeklyFeatureRow } from "@/lib/baseline";
import { InMemoryVaultRepository } from "@/lib/db/vault-repository";
import { InMemoryWeeklyFeatureRepository } from "@/lib/db/weekly-feature-repository";
import { gate } from "@/lib/signal";
import { NO_CHANGE_TEXT } from "@/lib/summary";

const USER_ID = "user-1";

const MAYA_ROWS: WeeklyFeatureRow[] = (mayaWeekly as Array<Record<string, unknown>>).map((r) => ({
  weekStart: r.week_start as string,
  vocabulary_diversity: r.vocabulary_diversity as number | null,
  mean_sentence_length: r.mean_sentence_length as number | null,
  filler_rate: r.filler_rate as number | null,
  sleep_hours: r.sleep_hours as number | null,
  active_minutes: r.active_minutes as number | null,
  twin_accuracy: r.twin_accuracy as number | null,
  synthetic: r.synthetic as boolean,
}));

async function seeded(profile = mayaDemoProfile()) {
  const vault = new InMemoryVaultRepository();
  const weekly = new InMemoryWeeklyFeatureRepository();
  await vault.upsertProfile(USER_ID, profile);
  await weekly.upsertWeeklyFeatures(USER_ID, MAYA_ROWS);
  return { vault, weekly };
}

const today = () => "2048-10-30";

function textOf(body: unknown, key: string): string | undefined {
  const fields = (body as { fields: Array<{ key: string; text?: string }> }).fields;
  return fields.find((f) => f.key === key)?.text;
}

describe("getSummary (POST /api/summary)", () => {
  it("returns 404 without a profile", async () => {
    const outcome = await getSummary(
      new InMemoryVaultRepository(),
      new InMemoryWeeklyFeatureRepository(),
      USER_ID,
      {},
      today,
    );
    expect(outcome).toEqual({ status: 404, body: { error: "Profile not found" } });
  });

  it("returns Maya's 14 fields with the Synthetic_Label (Req 1.2, 4.2, 4.4)", async () => {
    const { vault, weekly } = await seeded();
    const outcome = await getSummary(vault, weekly, USER_ID, {}, today);

    expect(outcome.status).toBe(200);
    if (outcome.status !== 200) return;
    expect(outcome.body.fields).toHaveLength(14);
    expect(outcome.body.synthetic).toBe(true);
    expect(outcome.body.synthetic_label).toBe("Synthetic data");
    expect(textOf(outcome.body, "data_sources")).toContain("Includes synthetic data.");
    expect(textOf(outcome.body, "dates")).toBe("Baseline start: 2026-10-24 · Summary date: 2048-10-30");
  });

  it("puts discuss and contact into fields 11, 4 and 13 as written", async () => {
    const { vault, weekly } = await seeded();
    const outcome = await getSummary(
      vault,
      weekly,
      USER_ID,
      { discuss: "Sleep, and Mom's birthday plans.", contact: "maya@example.test" },
      today,
    );
    expect(textOf(outcome.body, "discuss")).toBe("Sleep, and Mom's birthday plans.");
    expect(textOf(outcome.body, "from")).toBe("iamyou · iamyou.si · maya@example.test");
    expect(textOf(outcome.body, "questions")).toBe("maya@example.test");
  });

  it("returns NO_CHANGE_TEXT for record_only even with a signal (Req 3.2)", async () => {
    const { vault, weekly } = await seeded({ ...mayaDemoProfile(), rtkSetting: "record_only" });
    const outcome = await getSummary(vault, weekly, USER_ID, {}, today, {
      detectSignal: () => ({ features: ["sleep_hours", "twin_accuracy"], firstWeek: "2047-01-01", detectedWeek: "2047-01-15" }),
      gate,
      computeBaseline,
      zScores,
      recentMean,
    });
    expect(textOf(outcome.body, "what_changed")).toBe(NO_CHANGE_TEXT);
    expect(textOf(outcome.body, "subject")).toBe("iamyou Care Summary, Update, M. Linden");
  });

  it("writes nothing to either repository", async () => {
    const { vault, weekly } = await seeded();
    const writes = [
      vi.spyOn(vault, "upsertProfile"),
      vi.spyOn(vault, "addVaultEntry"),
      vi.spyOn(vault, "upsertVaultEntry"),
      vi.spyOn(vault, "createPrediction"),
      vi.spyOn(vault, "createAnswer"),
      vi.spyOn(vault, "deleteVault"),
      vi.spyOn(weekly, "upsertWeeklyFeatures"),
      vi.spyOn(weekly, "deleteForUser"),
    ];
    await getSummary(vault, weekly, USER_ID, { discuss: "x", contact: "y" }, today);
    for (const spy of writes) expect(spy).not.toHaveBeenCalled();
    expect(await weekly.listWeeklyFeatures(USER_ID)).toHaveLength(MAYA_ROWS.length);
  });
});
