// Feature: care-outputs, Task 4.2: the family-history relation through
// SupabaseVaultRepository.
//
// A fake Supabase client records upserts and returns canned rows, so no test
// reaches Supabase. Covers the column mapping both ways and the fallback that
// keeps the demo seed working before migration 0004 is applied.
//
// Validates: Requirements 1.2
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { mayaDemoProfile } from "@/app/api/demo/start/route";
import { SupabaseVaultRepository } from "@/lib/db/vault-repository";

type Row = Record<string, unknown>;

/** A fake client whose profile upsert fails while `missingColumn` is set. */
function fakeClient(options: { missingColumn?: boolean; selectRow?: Row } = {}) {
  const upserts: Row[] = [];
  const client = {
    from: () => ({
      upsert: async (row: Row) => {
        upserts.push(row);
        if (options.missingColumn && "family_history_relation" in row) {
          return {
            error: {
              code: "PGRST204",
              message: "Could not find the 'family_history_relation' column of 'profiles' in the schema cache",
            },
          };
        }
        return { error: null };
      },
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: options.selectRow ?? null, error: null }) }),
      }),
    }),
  } as unknown as SupabaseClient;
  return { client, upserts };
}

describe("SupabaseVaultRepository family_history_relation", () => {
  it("writes the relation column", async () => {
    const { client, upserts } = fakeClient();
    await new SupabaseVaultRepository(client).upsertProfile("u1", mayaDemoProfile());
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({ family_history: "familial_alzheimers", family_history_relation: "father" });
  });

  it("stores the profile without the relation when migration 0004 is missing", async () => {
    const { client, upserts } = fakeClient({ missingColumn: true });
    await new SupabaseVaultRepository(client).upsertProfile("u1", mayaDemoProfile());
    expect(upserts).toHaveLength(2);
    expect(upserts[1]).not.toHaveProperty("family_history_relation");
    expect(upserts[1]).toMatchObject({ user_id: "u1", first_name: "Maya" });
  });

  it("reads the relation, and null when the column is absent", async () => {
    const base = {
      user_id: "u1",
      first_name: "Maya",
      last_name: "Linden",
      date_of_birth: "2008-03-14",
      county: "Hampshire",
      family_history: "familial_alzheimers",
      health_layer_opt_in: true,
      rtk_setting: "tell_me",
      digital_will: null,
      synthetic: true,
    };
    const withRelation = fakeClient({ selectRow: { ...base, family_history_relation: "father" } });
    expect((await new SupabaseVaultRepository(withRelation.client).getProfile("u1"))?.familyHistoryRelation).toBe(
      "father",
    );
    const withoutColumn = fakeClient({ selectRow: base });
    expect((await new SupabaseVaultRepository(withoutColumn.client).getProfile("u1"))?.familyHistoryRelation).toBeNull();
  });
});
