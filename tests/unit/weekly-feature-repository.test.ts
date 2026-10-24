// Feature: health-baseline, Task 8.3: unit tests for the weekly feature repository.
//
// These tests exercise `lib/db/weekly-feature-repository.ts`:
//   - `InMemoryWeeklyFeatureRepository`, the implementation injected by the
//     timeline, demo-seed and vault route tests and by property P17. They prove
//     that upserting the same rows twice yields no duplicates (Req 2.3, 2.10);
//     the list is sorted by `weekStart` and scoped to the owner (Req 2.4, 7.1);
//     returned rows are copies; and `deleteForUser` leaves other users' rows
//     intact (Req 2.11).
//   - `toNullableNumber`, which maps `numeric` column values (number or numeric
//     string) to `number | null`, so a missing measurement is never read as 0.
//   - `SupabaseWeeklyFeatureRepository`, run against a small in-process fake
//     client (no network): upserts go out in chunks of 500 with
//     `onConflict: 'user_id,week_start'`, reads page with `.range()` in pages of
//     1,000, every statement filters by `user_id`, and `week_start` maps to
//     `weekStart`.
//
// Validates: Requirements 2.3, 2.4, 2.10, 2.11, 7.1
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import type { WeeklyFeatureRow } from "@/lib/baseline";
import {
  InMemoryWeeklyFeatureRepository,
  SupabaseWeeklyFeatureRepository,
  toNullableNumber,
} from "@/lib/db/weekly-feature-repository";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const USER_ID = "user-1";
const OTHER_USER_ID = "user-2";

/** A synthetic weekly row; every feature present unless overridden. */
function makeRow(
  weekStart: string,
  overrides: Partial<WeeklyFeatureRow> = {},
): WeeklyFeatureRow {
  return {
    weekStart,
    vocabulary_diversity: 0.62,
    mean_sentence_length: 14.2,
    filler_rate: 0.031,
    sleep_hours: 7.31,
    active_minutes: 42,
    twin_accuracy: 0.81,
    synthetic: true,
    ...overrides,
  };
}

/** `count` consecutive Monday week starts beginning 2000-01-03. */
function makeWeeks(count: number): WeeklyFeatureRow[] {
  const start = Date.UTC(2000, 0, 3);
  return Array.from({ length: count }, (_, i) =>
    makeRow(
      new Date(start + i * 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      { active_minutes: i },
    ),
  );
}

/* -------------------------------------------------------------------------- */
/* InMemoryWeeklyFeatureRepository                                            */
/* -------------------------------------------------------------------------- */

describe("InMemoryWeeklyFeatureRepository upsert", () => {
  it("upserting the same rows twice yields no duplicates (Req 2.3, 2.10)", async () => {
    const repo = new InMemoryWeeklyFeatureRepository();
    const rows = [makeRow("2020-01-06"), makeRow("2020-01-13")];

    await repo.upsertWeeklyFeatures(USER_ID, rows);
    await repo.upsertWeeklyFeatures(USER_ID, rows);

    const listed = await repo.listWeeklyFeatures(USER_ID);
    expect(listed).toHaveLength(2);
    expect(listed).toEqual(rows);
  });

  it("a repeated weekStart replaces the stored row rather than adding one (Req 2.3)", async () => {
    const repo = new InMemoryWeeklyFeatureRepository();

    await repo.upsertWeeklyFeatures(USER_ID, [makeRow("2020-01-06")]);
    await repo.upsertWeeklyFeatures(USER_ID, [
      makeRow("2020-01-06", { sleep_hours: 6.5, filler_rate: null }),
    ]);

    const listed = await repo.listWeeklyFeatures(USER_ID);
    expect(listed).toHaveLength(1);
    expect(listed[0].sleep_hours).toBe(6.5);
    expect(listed[0].filler_rate).toBeNull();
  });
});

describe("InMemoryWeeklyFeatureRepository listWeeklyFeatures", () => {
  it("returns rows sorted by ascending weekStart regardless of insert order (Req 7.1)", async () => {
    const repo = new InMemoryWeeklyFeatureRepository();

    await repo.upsertWeeklyFeatures(USER_ID, [
      makeRow("2020-03-02"),
      makeRow("2019-12-30"),
    ]);
    await repo.upsertWeeklyFeatures(USER_ID, [makeRow("2020-01-06")]);

    const listed = await repo.listWeeklyFeatures(USER_ID);
    expect(listed.map((r) => r.weekStart)).toEqual([
      "2019-12-30",
      "2020-01-06",
      "2020-03-02",
    ]);
  });

  it("is scoped to the owner (Req 2.4)", async () => {
    const repo = new InMemoryWeeklyFeatureRepository();

    await repo.upsertWeeklyFeatures(USER_ID, [makeRow("2020-01-06")]);
    await repo.upsertWeeklyFeatures(OTHER_USER_ID, [
      makeRow("2020-01-13", { synthetic: false }),
    ]);

    expect(
      (await repo.listWeeklyFeatures(USER_ID)).map((r) => r.weekStart),
    ).toEqual(["2020-01-06"]);
    expect(
      (await repo.listWeeklyFeatures(OTHER_USER_ID)).map((r) => r.weekStart),
    ).toEqual(["2020-01-13"]);
    expect(await repo.listWeeklyFeatures("nobody")).toEqual([]);
  });
});

describe("InMemoryWeeklyFeatureRepository returned rows are copies", () => {
  it("mutating a listed row does not change stored state", async () => {
    const repo = new InMemoryWeeklyFeatureRepository();
    await repo.upsertWeeklyFeatures(USER_ID, [makeRow("2020-01-06")]);

    const first = await repo.listWeeklyFeatures(USER_ID);
    first[0].sleep_hours = 0;
    first[0].weekStart = "1999-01-04";
    first.pop();

    const second = await repo.listWeeklyFeatures(USER_ID);
    expect(second).toEqual([makeRow("2020-01-06")]);
  });

  it("mutating an input row after upsert does not change stored state", async () => {
    const repo = new InMemoryWeeklyFeatureRepository();
    const input = makeRow("2020-01-06");
    await repo.upsertWeeklyFeatures(USER_ID, [input]);

    input.sleep_hours = 0;

    const listed = await repo.listWeeklyFeatures(USER_ID);
    expect(listed[0].sleep_hours).toBe(7.31);
  });
});

describe("InMemoryWeeklyFeatureRepository deleteForUser", () => {
  it("removes every row of the caller and leaves other users intact (Req 2.11)", async () => {
    const repo = new InMemoryWeeklyFeatureRepository();
    const otherRows = [makeRow("2020-01-06"), makeRow("2020-01-13")];
    await repo.upsertWeeklyFeatures(USER_ID, makeWeeks(5));
    await repo.upsertWeeklyFeatures(OTHER_USER_ID, otherRows);

    await repo.deleteForUser(USER_ID);

    expect(await repo.listWeeklyFeatures(USER_ID)).toEqual([]);
    expect(await repo.listWeeklyFeatures(OTHER_USER_ID)).toEqual(otherRows);
  });
});

/* -------------------------------------------------------------------------- */
/* toNullableNumber                                                           */
/* -------------------------------------------------------------------------- */

describe("toNullableNumber", () => {
  it('maps the numeric string "7.31" to 7.31', () => {
    expect(toNullableNumber("7.31")).toBe(7.31);
  });

  it("maps null to null, never 0", () => {
    expect(toNullableNumber(null)).toBeNull();
  });

  it("passes finite numbers through and maps non-numeric values to null", () => {
    expect(toNullableNumber(0)).toBe(0);
    expect(toNullableNumber(42)).toBe(42);
    expect(toNullableNumber(undefined)).toBeNull();
    expect(toNullableNumber("")).toBeNull();
    expect(toNullableNumber("abc")).toBeNull();
    expect(toNullableNumber(Number.NaN)).toBeNull();
    expect(toNullableNumber(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* SupabaseWeeklyFeatureRepository (fake client, no network)                  */
/* -------------------------------------------------------------------------- */

type DbRow = Record<string, unknown> & { user_id: string; week_start: string };

type Call =
  | { op: "upsert"; table: string; rows: DbRow[]; options: unknown }
  | {
      op: "select";
      table: string;
      columns: string;
      filters: [string, unknown][];
      order: { column: string; ascending: boolean } | null;
      range: [number, number] | null;
    }
  | { op: "delete"; table: string; filters: [string, unknown][] };

/**
 * A minimal in-process stand-in for the Supabase query builder covering the
 * calls the repository makes: `from().upsert()`, `from().select().eq().order()
 * .range()` and `from().delete().eq()`. It keeps snake_case rows in `rows`,
 * applies `eq` filters, ordering and ranges, and records every statement in
 * `calls`.
 */
class FakeSupabase {
  rows: DbRow[] = [];
  calls: Call[] = [];

  from(table: string) {
    const db = this;
    const state = {
      op: "select" as "select" | "delete",
      columns: "*",
      filters: [] as [string, unknown][],
      order: null as { column: string; ascending: boolean } | null,
      range: null as [number, number] | null,
    };
    const builder = {
      upsert(rows: DbRow[], options: unknown) {
        db.calls.push({ op: "upsert", table, rows, options });
        for (const row of rows) {
          const i = db.rows.findIndex(
            (r) => r.user_id === row.user_id && r.week_start === row.week_start,
          );
          if (i >= 0) db.rows[i] = { ...row };
          else db.rows.push({ ...row });
        }
        return Promise.resolve({ data: null, error: null });
      },
      select(columns: string) {
        state.op = "select";
        state.columns = columns;
        return builder;
      },
      delete() {
        state.op = "delete";
        return builder;
      },
      eq(column: string, value: unknown) {
        state.filters.push([column, value]);
        return builder;
      },
      order(column: string, opts: { ascending: boolean }) {
        state.order = { column, ascending: opts.ascending };
        return builder;
      },
      range(from: number, to: number) {
        state.range = [from, to];
        return builder;
      },
      then<T>(
        resolve: (value: { data: DbRow[] | null; error: null }) => T,
        reject?: (reason: unknown) => T,
      ) {
        try {
          const matches = (r: DbRow) =>
            state.filters.every(([c, v]) => r[c] === v);
          if (state.op === "delete") {
            db.calls.push({ op: "delete", table, filters: state.filters });
            db.rows = db.rows.filter((r) => !matches(r));
            return Promise.resolve(resolve({ data: null, error: null }));
          }
          db.calls.push({
            op: "select",
            table,
            columns: state.columns,
            filters: state.filters,
            order: state.order,
            range: state.range,
          });
          let out = db.rows.filter(matches).map((r) => ({ ...r }));
          if (state.order) {
            const { column, ascending } = state.order;
            out.sort((a, b) => {
              const cmp = String(a[column]).localeCompare(String(b[column]));
              return ascending ? cmp : -cmp;
            });
          }
          if (state.range) out = out.slice(state.range[0], state.range[1] + 1);
          return Promise.resolve(resolve({ data: out, error: null }));
        } catch (err) {
          if (reject) return Promise.resolve(reject(err));
          throw err;
        }
      },
    };
    return builder;
  }

  asClient(): SupabaseClient {
    return this as unknown as SupabaseClient;
  }
}

function supabaseRepo() {
  const fake = new FakeSupabase();
  return { fake, repo: new SupabaseWeeklyFeatureRepository(fake.asClient()) };
}

describe("SupabaseWeeklyFeatureRepository upsertWeeklyFeatures", () => {
  it("sends chunks of 500 with onConflict 'user_id,week_start' and user_id on every row (Req 2.3, 2.10)", async () => {
    const { fake, repo } = supabaseRepo();
    const rows = makeWeeks(1149);

    await repo.upsertWeeklyFeatures(USER_ID, rows);

    const upserts = fake.calls.filter((c) => c.op === "upsert");
    expect(upserts.map((c) => c.rows.length)).toEqual([500, 500, 149]);
    for (const call of upserts) {
      expect(call.table).toBe("weekly_features");
      expect(call.options).toEqual({ onConflict: "user_id,week_start" });
      expect(call.rows.every((r) => r.user_id === USER_ID)).toBe(true);
    }
  });

  it("maps weekStart to the snake_case week_start column", async () => {
    const { fake, repo } = supabaseRepo();

    await repo.upsertWeeklyFeatures(USER_ID, [makeRow("2020-01-06")]);

    const call = fake.calls[0];
    expect(call.op).toBe("upsert");
    if (call.op !== "upsert") return;
    expect(call.rows[0]).toEqual({
      user_id: USER_ID,
      week_start: "2020-01-06",
      vocabulary_diversity: 0.62,
      mean_sentence_length: 14.2,
      filler_rate: 0.031,
      sleep_hours: 7.31,
      active_minutes: 42,
      twin_accuracy: 0.81,
      synthetic: true,
    });
    expect(call.rows[0]).not.toHaveProperty("weekStart");
  });

  it("issues no request for an empty row list", async () => {
    const { fake, repo } = supabaseRepo();

    await repo.upsertWeeklyFeatures(USER_ID, []);

    expect(fake.calls).toEqual([]);
  });

  it("upserting the same rows twice yields no duplicates (Req 2.10)", async () => {
    const { repo } = supabaseRepo();
    const rows = makeWeeks(3);

    await repo.upsertWeeklyFeatures(USER_ID, rows);
    await repo.upsertWeeklyFeatures(USER_ID, rows);

    expect(await repo.listWeeklyFeatures(USER_ID)).toEqual(rows);
  });
});

describe("SupabaseWeeklyFeatureRepository listWeeklyFeatures", () => {
  it("pages with .range() in pages of 1,000, filtered by user_id and ordered by week_start (Req 2.4, 7.1)", async () => {
    const { fake, repo } = supabaseRepo();
    const rows = makeWeeks(2050);
    await repo.upsertWeeklyFeatures(USER_ID, rows);
    await repo.upsertWeeklyFeatures(OTHER_USER_ID, [makeRow("1990-01-01")]);
    fake.calls = [];

    const listed = await repo.listWeeklyFeatures(USER_ID);

    expect(listed).toHaveLength(2050);
    expect(listed).toEqual(rows);
    const selects = fake.calls.filter((c) => c.op === "select");
    expect(selects.map((c) => c.range)).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
    for (const call of selects) {
      expect(call.table).toBe("weekly_features");
      expect(call.filters).toEqual([["user_id", USER_ID]]);
      expect(call.order).toEqual({ column: "week_start", ascending: true });
    }
  });

  it("maps snake_case numeric strings and nulls to a camelCase WeeklyFeatureRow", async () => {
    const { fake, repo } = supabaseRepo();
    fake.rows.push({
      user_id: USER_ID,
      week_start: "2020-01-06",
      vocabulary_diversity: "0.62",
      mean_sentence_length: 14.2,
      filler_rate: null,
      sleep_hours: "7.31",
      active_minutes: "42",
      twin_accuracy: null,
      synthetic: false,
    });

    expect(await repo.listWeeklyFeatures(USER_ID)).toEqual([
      {
        weekStart: "2020-01-06",
        vocabulary_diversity: 0.62,
        mean_sentence_length: 14.2,
        filler_rate: null,
        sleep_hours: 7.31,
        active_minutes: 42,
        twin_accuracy: null,
        synthetic: false,
      },
    ]);
  });
});

describe("SupabaseWeeklyFeatureRepository deleteForUser", () => {
  it("issues one delete filtered by user_id and leaves other users intact (Req 2.11)", async () => {
    const { fake, repo } = supabaseRepo();
    const otherRows = makeWeeks(2);
    await repo.upsertWeeklyFeatures(USER_ID, makeWeeks(4));
    await repo.upsertWeeklyFeatures(OTHER_USER_ID, otherRows);
    fake.calls = [];

    await repo.deleteForUser(USER_ID);

    expect(fake.calls).toEqual([
      {
        op: "delete",
        table: "weekly_features",
        filters: [["user_id", USER_ID]],
      },
    ]);
    expect(await repo.listWeeklyFeatures(USER_ID)).toEqual([]);
    expect(await repo.listWeeklyFeatures(OTHER_USER_ID)).toEqual(otherRows);
  });
});
