// Feature: care-outputs, Task 4.1: static check of 0004_care_outputs.sql.
//
// The SQL is read as text; no live database is used. The migration only adds
// one nullable, length-checked column to `profiles`, whose RLS policies already
// cover it, so it must not create tables or touch policies.
//
// Validates: Requirements 1.2
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(join(process.cwd(), "supabase/migrations/0004_care_outputs.sql"), "utf8")
  .replace(/--[^\n]*/g, "")
  .replace(/\s+/g, " ")
  .trim()
  .toLowerCase();

describe("0004_care_outputs migration", () => {
  it("adds the nullable family_history_relation column with a 1-40 character check", () => {
    expect(sql).toContain("alter table profiles add column if not exists family_history_relation text");
    expect(sql).toContain(
      "check (family_history_relation is null or char_length(family_history_relation) between 1 and 40)",
    );
    expect(sql).not.toContain("not null");
  });

  it("creates no table and changes no policy", () => {
    expect(sql).not.toContain("create table");
    expect(sql).not.toContain("policy");
    expect(sql).not.toContain("drop ");
  });
});
