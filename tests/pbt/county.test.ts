// Feature: health-baseline, Property 15: County CSV parsing round-trips
// Validates: Requirements 8.1, 8.2
//
// For rows whose cells contain no comma, CR or LF, printing them with the local
// helper `formatShortSleepCsv` (header in any column order, LF or CRLF endings,
// with or without a final line ending) and parsing with `parseShortSleepCsv`
// returns the same rows, in order, with every cell unchanged.
//
// Generator note: the header has six columns, so every printed data line holds
// at least five commas and is never the empty string. Rows of all-empty cells
// therefore cannot collide with the parser's "drop trailing empty lines" rule,
// and cells are left unconstrained apart from the comma/CR/LF exclusion.
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  findCountyCard,
  parseShortSleepCsv,
  type ShortSleepCsvRow,
} from "@/lib/county";

const COLUMNS = [
  "year",
  "county",
  "prevalence",
  "low",
  "high",
  "population",
] as const satisfies readonly (keyof ShortSleepCsvRow)[];

type Column = (typeof COLUMNS)[number];

/** Test-only CSV printer: header in the given column order, no quoting. */
function formatShortSleepCsv(
  rows: readonly ShortSleepCsvRow[],
  columns: readonly Column[],
  eol: "\n" | "\r\n",
  trailingEol: boolean,
): string {
  const lines = [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => row[column]).join(",")),
  ];
  return lines.join(eol) + (trailingEol ? eol : "");
}

// A cell: any string (full Unicode, including quotes, spaces and U+FEFF) with
// commas, CR and LF removed, mixed with realistic CDC-style values.
const cellArb: fc.Arbitrary<string> = fc.oneof(
  fc.string({ unit: "binary", maxLength: 12 }).map((s) => s.replace(/[,\r\n]/g, "")),
  fc.constantFrom("", "2022", "Hampshire", "hampshire", "31.5", "26.8", "36.4", "\"x\"", " ", "\uFEFF"),
);

const rowArb: fc.Arbitrary<ShortSleepCsvRow> = fc.record({
  year: cellArb,
  county: cellArb,
  prevalence: cellArb,
  low: cellArb,
  high: cellArb,
  population: cellArb,
});

const columnOrderArb: fc.Arbitrary<Column[]> = fc.shuffledSubarray([...COLUMNS], {
  minLength: COLUMNS.length,
  maxLength: COLUMNS.length,
});

describe("lib/county", () => {
  it("Property 15: County CSV parsing round-trips", () => {
    fc.assert(
      fc.property(
        fc.array(rowArb, { maxLength: 20 }),
        columnOrderArb,
        fc.constantFrom<"\n" | "\r\n">("\n", "\r\n"),
        fc.boolean(),
        (rows, columns, eol, trailingEol) => {
          const text = formatShortSleepCsv(rows, columns, eol, trailingEol);
          expect(parseShortSleepCsv(text)).toEqual(rows);
        },
      ),
      { numRuns: 200 },
    );
  });

  // Feature: health-baseline, Property 16: County lookup is exact and fails closed
  // Validates: Requirements 8.1, 8.2, 8.3, 8.12
  //
  // For tables mixing valid rows, invalid rows (bad year, non-numeric or
  // out-of-range percentages, low > prevalence, prevalence > high) and duplicate
  // counties, and for queries that are exact row counties, case variants, pool
  // names, null, undefined, '' or any non-string value, `findCountyCard` returns a
  // card exactly when the query is a non-empty string equal to the `county` of
  // exactly one row whose values are valid. The card holds exactly the five card
  // keys, equal to `Number` of the source cells, and never `population`.
  it("Property 16: County lookup is exact and fails closed", () => {
    fc.assert(
      fc.property(
        fc.array(lookupRowArb, { maxLength: 12 }).chain((rows) =>
          fc.tuple(fc.constant(rows), lookupQueryArb(rows)),
        ),
        ([rows, query]) => {
          const card = findCountyCard(rows, query);

          const matches =
            typeof query === "string" && query !== ""
              ? rows.filter((row) => row.county === query)
              : [];
          const expected = matches.length === 1 ? expectedCard(matches[0]) : null;

          if (expected === null) {
            expect(card).toBeNull();
            return;
          }
          expect(card).toStrictEqual(expected);
          expect(Object.keys(card as object).sort()).toEqual(CARD_KEYS);
          expect(card).not.toHaveProperty("population");
        },
      ),
      { numRuns: 300 },
    );
  });
});

// ---------------------------------------------------------------------------
// P16 helpers
// ---------------------------------------------------------------------------

const CARD_KEYS = ["county", "high", "low", "prevalence", "year"];

/** Test oracle from the design text: valid year and percentages, ordered. */
function expectedCard(row: ShortSleepCsvRow) {
  if (!/^[0-9]{4}$/.test(row.year)) return null;
  const percent = (cell: string): number | null => {
    if (!/^[0-9]+(\.[0-9]+)?$/.test(cell)) return null;
    const value = Number(cell);
    return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
  };
  const prevalence = percent(row.prevalence);
  const low = percent(row.low);
  const high = percent(row.high);
  if (prevalence === null || low === null || high === null) return null;
  if (low > prevalence || prevalence > high) return null;
  return { county: row.county, year: Number(row.year), prevalence, low, high };
}

// Small shared pool so duplicates and case variants occur often.
const COUNTY_POOL = [
  "Hampshire",
  "hampshire",
  "HAMPSHIRE",
  "Hampshire ",
  "Suffolk",
  "Berkshire",
  "Essex",
];

const lookupCountyArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 4, arbitrary: fc.constantFrom(...COUNTY_POOL) },
  { weight: 1, arbitrary: fc.string({ maxLength: 8 }) },
);

const lookupYearArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 4, arbitrary: fc.integer({ min: 1990, max: 2030 }).map(String) },
  {
    weight: 1,
    arbitrary: fc.constantFrom("22", "20222", "2022.0", " 2022", "abcd", "", "-202"),
  },
);

/** A percentage cell with one decimal place, e.g. "31.5", from tenths. */
const tenthsToCell = (tenths: number): string =>
  tenths % 10 === 0 ? String(tenths / 10) : (tenths / 10).toFixed(1);

const invalidPercentArb: fc.Arbitrary<string> = fc.constantFrom(
  "",
  "abc",
  "-1",
  "100.1",
  "101",
  "1e2",
  " 31.5",
  "31.",
  ".5",
  "NaN",
  "Infinity",
  "31,5",
);

const anyPercentArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 4, arbitrary: fc.integer({ min: 0, max: 1000 }).map(tenthsToCell) },
  { weight: 1, arbitrary: fc.constantFrom("0", "100", "007.50", "100.0", "0.0") },
  { weight: 1, arbitrary: invalidPercentArb },
);

// Either an ordered valid triple (low <= prevalence <= high) or three free cells,
// which covers out-of-order and invalid values.
const percentTripleArb: fc.Arbitrary<{ low: string; prevalence: string; high: string }> =
  fc.oneof(
    {
      weight: 2,
      arbitrary: fc
        .tuple(
          fc.integer({ min: 0, max: 1000 }),
          fc.integer({ min: 0, max: 1000 }),
          fc.integer({ min: 0, max: 1000 }),
        )
        .map((values) => values.sort((a, b) => a - b))
        .map(([low, prevalence, high]) => ({
          low: tenthsToCell(low),
          prevalence: tenthsToCell(prevalence),
          high: tenthsToCell(high),
        })),
    },
    {
      weight: 1,
      arbitrary: fc.record({ low: anyPercentArb, prevalence: anyPercentArb, high: anyPercentArb }),
    },
  );

const lookupRowArb: fc.Arbitrary<ShortSleepCsvRow> = fc
  .tuple(lookupCountyArb, lookupYearArb, percentTripleArb, fc.string({ maxLength: 8 }))
  .map(([county, year, triple, population]) => ({
    year,
    county,
    prevalence: triple.prevalence,
    low: triple.low,
    high: triple.high,
    population,
  }));

/** Queries: row counties, their case variants, pool names, and non-matches. */
function lookupQueryArb(rows: readonly ShortSleepCsvRow[]): fc.Arbitrary<unknown> {
  const fromRows: fc.Arbitrary<unknown>[] =
    rows.length === 0
      ? []
      : [
          fc.constantFrom(...rows.map((row) => row.county)),
          fc
            .constantFrom(...rows.map((row) => row.county))
            .chain((county) =>
              fc.constantFrom(county.toUpperCase(), county.toLowerCase(), ` ${county}`),
            ),
        ];
  return fc.oneof(
    ...fromRows,
    fc.constantFrom(...COUNTY_POOL),
    fc.constantFrom(null, undefined, ""),
    fc.anything(),
  );
}
