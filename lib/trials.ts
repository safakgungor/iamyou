/**
 * The pure trial-finder logic for care-outputs. No I/O.
 *
 * Normalizes both trial sources — the ClinicalTrials.gov API v2 (`live`) and the
 * saved Massachusetts slice `data/public/clinicaltrials-ma-recruiting-2026-10-18.csv`
 * (`saved_ma_slice`) — into one `Trial` shape, labels phases in plain language,
 * matches rows to the family condition by keyword, and filters to recruiting
 * Massachusetts studies. It is the target of property tests P1 and P5.
 *
 * The HTTP fetch, the CSV file read and the cache live in the server route
 * `app/api/trials/route.ts` (Req 5.8). This module imports nothing server-only,
 * so screens may import its display constants and URL helpers.
 */

/** The family conditions the trial finder searches for. (Req 5.2) */
export type FamilyCondition = 'huntington' | 'familial_alzheimers' | 'als';

/** Where a normalized trial came from. (Req 7.1) */
export type TrialSource = 'live' | 'saved_ma_slice';

/** The normalized trial record shared by both sources. (Req 7.1) */
export type Trial = {
  nctId: string;
  title: string;
  phaseLabel: string;
  conditions: string[];
  status: string;
  cities: string[];
  source: TrialSource;
};

/** The three family conditions, exported for validation and generators. */
export const FAMILY_CONDITIONS: readonly FamilyCondition[] = [
  'huntington',
  'familial_alzheimers',
  'als',
] as const;

/** Narrows an unknown value (e.g. `profile.family_history`) to a `FamilyCondition`. */
export function isFamilyCondition(value: unknown): value is FamilyCondition {
  return (FAMILY_CONDITIONS as readonly unknown[]).includes(value);
}

/** The empty-state text for both an empty live result and an empty fallback. (Req 6.5) */
export const NO_MATCH_TEXT = 'No matching studies recruiting in Massachusetts right now.';

/** Shown on every trial list. (Req 8.7) */
export const NOT_A_RECOMMENDATION_TEXT =
  'Listing a study here is not a recommendation to join it.';

export const MASSACHUSETTS = 'Massachusetts';

/** The only status the trial finder lists. (Req 8.1) */
export const RECRUITING = 'RECRUITING';

/** `query.cond` term per condition (Req 5.1) and the Condition_Search_URL term (Req 6.5). */
export const CONDITION_QUERY: Record<FamilyCondition, string> = {
  huntington: 'Huntington Disease',
  familial_alzheimers: 'Alzheimer Disease',
  als: 'Amyotrophic Lateral Sclerosis',
};

/* -------------------------------------------------------------------------- */
/* Phase labels (Req 7.3–7.6 / P5)                                            */
/* -------------------------------------------------------------------------- */

/** Plain-language label per recognized phase token. (Req 7.3, 7.4) */
export const PHASE_LABELS: ReadonlyMap<string, string> = new Map([
  ['EARLY_PHASE1', 'Early phase 1: very first small tests in people'],
  ['PHASE1', 'Phase 1: first tests in people'],
  ['PHASE2', 'Phase 2: testing whether it works and is safe'],
  ['PHASE3', 'Phase 3: comparing it with standard care in more people'],
  ['PHASE4', 'Phase 4: studying it after approval'],
  ['NA', 'Not a drug trial'],
]);

/** The single fallback label for a blank, absent or unrecognized phase. (Req 7.6) */
export const PHASE_NOT_LISTED = 'Phase not listed';

/** Separator between the labels of a combined phase value. (Req 7.5) */
export const PHASE_LABEL_SEPARATOR = ' / ';

/**
 * Maps a raw phase value to a deterministic plain-language label. Accepts the
 * CSV form (`"PHASE1, PHASE2"`) and the API form (`["PHASE1", "PHASE2"]`).
 * Tokens are split on commas, trimmed and upper-cased; recognized tokens are
 * deduplicated and their labels joined with " / " in input order; unrecognized
 * tokens are skipped. Returns `PHASE_NOT_LISTED` when nothing is recognized.
 * (Req 7.3–7.6 / P5)
 */
export function phaseLabel(raw: unknown): string {
  const parts: unknown[] = Array.isArray(raw) ? raw : [raw];
  const tokens = parts.flatMap((part) => (typeof part === 'string' ? part.split(',') : []));

  const seen = new Set<string>();
  const labels: string[] = [];
  for (const token of tokens) {
    const key = token.trim().toUpperCase();
    const label = PHASE_LABELS.get(key);
    if (label !== undefined && !seen.has(key)) {
      seen.add(key);
      labels.push(label);
    }
  }

  return labels.length > 0 ? labels.join(PHASE_LABEL_SEPARATOR) : PHASE_NOT_LISTED;
}

/* -------------------------------------------------------------------------- */
/* Normalization (Req 6.3, 6.4, 7.1, 7.2)                                     */
/* -------------------------------------------------------------------------- */

/** Reads `value` as a plain object, or an empty one for any other shape. */
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** A trimmed string, or `""` for any non-string. (Req 7.2) */
function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** The trimmed, non-blank strings of an array, or `[]` for any non-array. (Req 7.2) */
function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(asString).filter((s) => s.length > 0);
}

/**
 * The cities of the locations whose `state` is Massachusetts (trimmed,
 * case-insensitive), in order and deduplicated. A blank city becomes
 * "Massachusetts", so a live trial has a Massachusetts location exactly when
 * this list is non-empty.
 */
function massachusettsCities(locations: unknown): string[] {
  if (!Array.isArray(locations)) return [];
  const cities: string[] = [];
  for (const location of locations) {
    const record = asRecord(location);
    if (asString(record.state).toLowerCase() !== MASSACHUSETTS.toLowerCase()) continue;
    const city = asString(record.city) || MASSACHUSETTS;
    if (!cities.includes(city)) cities.push(city);
  }
  return cities;
}

/**
 * Normalizes one raw study into a `Trial` with every field present; non-string
 * values become `""` and missing arrays `[]`. (Req 6.3, 6.4, 7.1, 7.2)
 *
 * - `live`: an API v2 study, read from `protocolSection`; `cities` keeps only
 *   Massachusetts locations.
 * - `saved_ma_slice`: a header-keyed CSV row; `status` is always RECRUITING and
 *   `cities` always `["Massachusetts"]`, because every slice row is recruiting
 *   and its `massachusetts_city` column is empty.
 */
export function normalizeTrial(raw: unknown, source: TrialSource): Trial {
  if (source === 'saved_ma_slice') {
    const row = asRecord(raw);
    return {
      nctId: asString(row.nct_id),
      title: asString(row.title),
      phaseLabel: phaseLabel(row.phase),
      conditions: asString(row.conditions)
        .split(',')
        .map((c) => c.trim())
        .filter((c) => c.length > 0),
      status: RECRUITING,
      cities: [MASSACHUSETTS],
      source: 'saved_ma_slice',
    };
  }

  const protocol = asRecord(asRecord(raw).protocolSection);
  const identification = asRecord(protocol.identificationModule);
  return {
    nctId: asString(identification.nctId),
    title: asString(identification.briefTitle),
    phaseLabel: phaseLabel(asRecord(protocol.designModule).phases),
    conditions: asStringList(asRecord(protocol.conditionsModule).conditions),
    status: asString(asRecord(protocol.statusModule).overallStatus),
    cities: massachusettsCities(asRecord(protocol.contactsLocationsModule).locations),
    source: 'live',
  };
}

/* -------------------------------------------------------------------------- */
/* Keyword matching (Req 6.2, 6.5)                                            */
/* -------------------------------------------------------------------------- */

/**
 * True when the trial's conditions or title name the family condition,
 * case-insensitively: "huntington"; "alzheimer"; "amyotrophic lateral
 * sclerosis", "motor neuron" or the whole word "ALS". Any other condition has
 * no keyword mapping and never matches. (Req 6.2, 6.5)
 */
export function matchesCondition(trial: Trial, condition: unknown): boolean {
  const conditions = Array.isArray(trial.conditions) ? trial.conditions : [];
  const haystack = `${conditions.join(' ')} ${trial.title}`.toLowerCase();

  switch (condition) {
    case 'huntington':
      return haystack.includes('huntington');
    case 'familial_alzheimers':
      return haystack.includes('alzheimer');
    case 'als':
      return (
        haystack.includes('amyotrophic lateral sclerosis') ||
        haystack.includes('motor neuron') ||
        /\bals\b/.test(haystack)
      );
    default:
      return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Filtering (Req 8.1–8.4 / P1)                                               */
/* -------------------------------------------------------------------------- */

/**
 * Keeps only recruiting Massachusetts trials, as new objects in input order,
 * never mutating the input. (Req 8.1–8.4 / P1)
 *
 * - drops any trial whose `status` is not exactly RECRUITING;
 * - `live`: keeps it only with at least one Massachusetts city;
 * - `saved_ma_slice`: keeps it, with `cities` set to `["Massachusetts"]`;
 * - any other `source`: drops it.
 */
export function filterTrials(trials: readonly Trial[]): Trial[] {
  const kept: Trial[] = [];
  for (const trial of trials) {
    if (trial.status !== RECRUITING) continue;
    if (trial.source === 'live') {
      if (trial.cities.length > 0) {
        kept.push({ ...trial, conditions: [...trial.conditions], cities: [...trial.cities] });
      }
    } else if (trial.source === 'saved_ma_slice') {
      kept.push({ ...trial, conditions: [...trial.conditions], cities: [MASSACHUSETTS] });
    }
  }
  return kept;
}

/* -------------------------------------------------------------------------- */
/* Saved slice CSV                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Splits CSV text into records per RFC 4180: quoted fields, doubled quotes, and
 * commas or newlines inside quotes. Accepts `\n` and `\r\n` line endings.
 */
function parseCsvRecords(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      record.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else {
      field += ch;
    }
  }

  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}

/**
 * Parses the saved slice into header-keyed rows. Blank lines are skipped and a
 * short row's missing columns become `""`. Pure: the route reads the file and
 * passes in the text.
 */
export function parseSliceCsv(text: string): Array<Record<string, string>> {
  const records = parseCsvRecords(text.replace(/^﻿/, ''));
  if (records.length === 0) return [];

  const [header, ...body] = records;
  const columns = header.map((name) => name.trim());
  return body
    .filter((record) => !(record.length === 1 && record[0].trim() === ''))
    .map((record) => Object.fromEntries(columns.map((name, i) => [name, record[i] ?? ''])));
}

/* -------------------------------------------------------------------------- */
/* URLs (Req 6.5, 8.5, 8.6)                                                   */
/* -------------------------------------------------------------------------- */

/** The study record link, or `null` for a blank id so no link is rendered. (Req 8.5, 8.6) */
export function studyUrl(nctId: string): string | null {
  const id = asString(nctId);
  return id.length > 0 ? `https://clinicaltrials.gov/study/${encodeURIComponent(id)}` : null;
}

/**
 * The ClinicalTrials.gov website search for the condition, limited to
 * recruiting studies in Massachusetts. (Req 6.5)
 */
export function conditionSearchUrl(condition: FamilyCondition): string {
  return (
    `https://clinicaltrials.gov/search?cond=${encodeURIComponent(CONDITION_QUERY[condition])}` +
    '&aggFilters=status:rec&country=United%20States&state=Massachusetts&locStr=Massachusetts'
  );
}
