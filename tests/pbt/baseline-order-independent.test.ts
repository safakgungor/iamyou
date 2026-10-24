// Feature: health-baseline, Property 9: History evaluation is order-independent and well-shaped
//
// Validates: Requirements 3.2, 3.15
//
// For any set of weekly rows (nulls, missing keys, non-finite values, gaps and
// duplicate weeks allowed) and any permutation of it, `zScores` and
// `computeBaseline` return deep-equal results. `zScores(rows)` has exactly one
// entry per input row, in ascending `weekStart` order, each carrying all six
// feature keys with a finite number or an explicit `null`; `zScores([])` is `[]`.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { FEATURES, computeBaseline, zScores } from "@/lib/baseline";
import { deepFreeze, permutationArb, weeklyRowsArb } from "./helpers/weekly-rows";

// Mix histories with frequent duplicate weeks (an exact copy or new values for
// the same weekStart) and histories with distinct weeks but more gaps and nulls.
const rowsArb = fc.oneof(
  weeklyRowsArb({ duplicateRate: 0.3 }),
  weeklyRowsArb({ duplicateRate: 0.05, nullRate: 0.3, gapRate: 0.2 }),
  weeklyRowsArb({ duplicateRate: 0 })
);

// The rows and an arbitrary reordering of the same rows, both deep-frozen so
// neither call can affect the other through mutation.
const rowsAndPermutationArb = rowsArb.chain((rows) =>
  permutationArb(rows).map((shuffled) => ({
    rows: deepFreeze(rows),
    shuffled: deepFreeze(shuffled),
  }))
);

const sortedFeatures = [...FEATURES].sort();

describe("zScores / computeBaseline (Property 9: order-independent and well-shaped)", () => {
  it("returns deep-equal results for any permutation, one well-shaped entry per row in ascending weekStart order", () => {
    fc.assert(
      fc.property(rowsAndPermutationArb, ({ rows, shuffled }) => {
        const z = zScores(rows);

        // Order-independence. (Req 3.2)
        expect(zScores(shuffled)).toStrictEqual(z);
        expect(computeBaseline(shuffled)).toStrictEqual(computeBaseline(rows));

        // Exactly one entry per input row, duplicates included. (Req 3.15)
        expect(z).toHaveLength(rows.length);
        const inputWeeks = rows.map((r) => r.weekStart).sort();
        expect(z.map((w) => w.weekStart)).toStrictEqual(inputWeeks);

        for (let i = 0; i < z.length; i++) {
          const entry = z[i];
          // Ascending weekStart (ISO dates compare lexically in date order).
          if (i > 0) expect(z[i - 1].weekStart <= entry.weekStart).toBe(true);

          // All six feature keys, each a finite number or an explicit null.
          expect(Object.keys(entry).sort()).toStrictEqual(["weekStart", "z"]);
          expect(Object.keys(entry.z).sort()).toStrictEqual(sortedFeatures);
          for (const f of FEATURES) {
            const v = entry.z[f];
            expect(v === null || (typeof v === "number" && Number.isFinite(v))).toBe(true);
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  it("returns [] for no rows", () => {
    expect(zScores([])).toStrictEqual([]);
  });
});
