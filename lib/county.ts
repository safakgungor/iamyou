/**
 * Pure CDC PLACES short-sleep county lookup for the health-baseline. No I/O:
 * the CSV file read stays in `app/api/county/route.ts`.
 *
 * `parseShortSleepCsv` is the target of property test P15 and `findCountyCard`
 * (with `toCountyCard`) the target of property test P16.
 */

/** One CSV data row, cells kept as the exact source strings. */
export type ShortSleepCsvRow = {
  year: string;
  county: string;
  prevalence: string;
  low: string;
  high: string;
  population: string;
};

/** The card values returned to the caller; never carries `population`. (Req 8.2) */
export type CountyCard = {
  county: string;
  year: number;
  prevalence: number;
  low: number;
  high: number;
};

const REQUIRED_COLUMNS = [
  'year',
  'county',
  'prevalence',
  'low',
  'high',
  'population',
] as const satisfies readonly (keyof ShortSleepCsvRow)[];

const YEAR_PATTERN = /^\d{4}$/;
const PERCENT_PATTERN = /^\d+(\.\d+)?$/;

/**
 * Parses the CDC PLACES short-sleep CSV; null when the header lacks a required
 * column (or names one more than once, which would make the mapping ambiguous).
 * Columns are mapped by header name in any order. Data lines whose comma-split
 * cell count differs from the header's are skipped. Cells are kept unchanged.
 * Quoted fields are not supported. (Req 8.1, 8.2)
 */
export function parseShortSleepCsv(text: string): ShortSleepCsvRow[] | null {
  const body = text.startsWith('\uFEFF') ? text.slice(1) : text;
  const lines = body.split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  if (lines.length === 0) return null;

  const header = lines[0].split(',');
  const index = {} as Record<keyof ShortSleepCsvRow, number>;
  for (const column of REQUIRED_COLUMNS) {
    const first = header.indexOf(column);
    if (first === -1 || header.lastIndexOf(column) !== first) return null;
    index[column] = first;
  }

  const rows: ShortSleepCsvRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = lines[i].split(',');
    if (cells.length !== header.length) continue;
    rows.push({
      year: cells[index.year],
      county: cells[index.county],
      prevalence: cells[index.prevalence],
      low: cells[index.low],
      high: cells[index.high],
      population: cells[index.population],
    });
  }
  return rows;
}

/** Converts a percentage cell; null unless it is a plain decimal in [0, 100]. */
function toPercent(cell: string): number | null {
  if (!PERCENT_PATTERN.test(cell)) return null;
  const value = Number(cell);
  if (!Number.isFinite(value) || value < 0 || value > 100) return null;
  return value;
}

/**
 * Validates and converts one row; null when any value is invalid. `population`
 * is never read. (Req 8.2, 8.12)
 */
export function toCountyCard(row: ShortSleepCsvRow): CountyCard | null {
  if (!YEAR_PATTERN.test(row.year)) return null;
  const prevalence = toPercent(row.prevalence);
  const low = toPercent(row.low);
  const high = toPercent(row.high);
  if (prevalence === null || low === null || high === null) return null;
  if (!(low <= prevalence && prevalence <= high)) return null;
  return {
    county: row.county,
    year: Number(row.year),
    prevalence,
    low,
    high,
  };
}

/**
 * Exact, case-sensitive single-row match, then validation. Zero or more than
 * one matching row (ambiguous) yields null. (Req 8.1–8.3, 8.12 / P16)
 */
export function findCountyCard(
  rows: readonly ShortSleepCsvRow[],
  county: unknown,
): CountyCard | null {
  if (typeof county !== 'string' || county === '') return null;
  let match: ShortSleepCsvRow | null = null;
  for (const row of rows) {
    if (row.county !== county) continue;
    if (match !== null) return null;
    match = row;
  }
  return match === null ? null : toCountyCard(match);
}
