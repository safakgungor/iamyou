/**
 * The clinician summary for care-outputs: `buildSummary`. Pure: no I/O, no
 * model call, no mutation of inputs, and identical output for identical input.
 * (Req 1.7)
 *
 * It assembles the 14 fields of `docs/clinician-summary-fields.md`, in order,
 * from the profile, the weekly feature rows and the person's own input. Every
 * mean and z-score comes from the `health-baseline` modules, never from local
 * arithmetic (Req 2.5), and the "What changed" field opens only when
 * `gate(signal, rtk_setting).includeInSummary` from `lib/signal.ts` is exactly
 * `true` (Req 3.4). It is the target of property test P3.
 *
 * health-baseline contract, as implemented (task 1):
 *   - `computeBaseline(rows)` returns each feature's frozen baseline set
 *     (`{ mean, sd, weeks } | null`, null below MIN_BASELINE_WEEKS weeks);
 *   - `zScores(rows)` returns one `{ weekStart, z }` per row, ascending, with
 *     `z[feature]` null while no baseline exists;
 *   - `recentMean(rows, feature, 4)` is the mean of the last four weeks;
 *   - `detectSignal(rows)` and `gate(signal, rtk_setting)` live in `lib/signal.ts`.
 */

import { computeBaseline, recentMean, zScores, type Feature, type WeeklyFeatureRow } from './baseline';
import { detectSignal, gate, type ChangeSignal } from './signal';
import type { Profile } from './db/vault-repository';

/** Field 2. (Req 1.5) */
export const SUMMARY_INTRO_TEXT =
  "This summary was prepared by iamyou at the person's request, from their own " +
  'conversations and wearable data. It is not a diagnosis and no clinician has reviewed it.';

/** Field 14, always rendered. (Req 1.6) */
export const NOT_A_DIAGNOSIS_FOOTER = 'This is not a diagnosis.';

/** Field 10 whenever the gate is closed or there is no signal. (Req 3.2, 3.5 / P3) */
export const NO_CHANGE_TEXT = 'No change to report.';

/** Field 5. */
export const FOCUS_TEXT = 'Personal baseline: language, sleep and activity';

/** Shown in place of a missing mean or z-score. (Req 2.3) */
export const NOT_AVAILABLE_TEXT = 'Not available';

export const SYNTHETIC_LABEL = 'Synthetic data';

/** Field 8 row order. (Req 2.1) */
export const SUMMARY_FEATURE_ORDER: readonly Feature[] = [
  'vocabulary_diversity',
  'mean_sentence_length',
  'filler_rate',
  'sleep_hours',
  'active_minutes',
  'twin_accuracy',
] as const;

/** Plain names for the field 8 rows and the field 10 text. */
export const FEATURE_LABELS: Record<Feature, string> = {
  vocabulary_diversity: 'Vocabulary diversity',
  mean_sentence_length: 'Mean sentence length',
  filler_rate: 'Filler words',
  sleep_hours: 'Sleep',
  active_minutes: 'Active minutes',
  twin_accuracy: 'Twin accuracy',
};

/** The family member's condition, as field 6 names it. It describes the relative, not the person. */
const FAMILY_CONDITION_TEXT: ReadonlyMap<unknown, string> = new Map([
  ['huntington', "Huntington's disease"],
  ['familial_alzheimers', "Familial Alzheimer's disease"],
  ['als', 'Amyotrophic lateral sclerosis (ALS)'],
]);
const FAMILY_HISTORY_OTHER_TEXT: ReadonlyMap<unknown, string> = new Map([
  ['prefer_not', 'Prefers not to say'],
]);
const NONE_REPORTED_TEXT = 'None reported';

/** Field 12, one fixed sentence per setting. */
const RTK_TEXT: ReadonlyMap<unknown, string> = new Map([
  ['tell_me', 'The person chose to see changes and share them with their clinician.'],
  [
    'doctor_only',
    'The person chose not to see changes themselves and to share them only with their clinician.',
  ],
  ['record_only', 'The person chose to record changes without seeing or sharing them.'],
]);
const RTK_UNKNOWN_TEXT = 'No setting recorded. Changes are not shared.';

const NO_CONTACT_TEXT = 'No contact chosen';
const NOTHING_ADDED_TEXT = 'Nothing added.';

export type SummaryInput = {
  profile: Pick<
    Profile,
    | 'firstName'
    | 'lastName'
    | 'dateOfBirth'
    | 'familyHistory'
    | 'familyHistoryRelation'
    | 'rtkSetting'
    | 'synthetic'
  >;
  rows: readonly WeeklyFeatureRow[];
  summaryDate: string; // ISO date, supplied by the route's clock
  discussText: string | null; // field 11, the person's own words
  contact: string | null; // fields 4 and 13
};

/** The health-baseline functions, injectable for tests. Defaults to the real modules. */
export type SummaryDeps = {
  detectSignal: typeof detectSignal;
  gate: typeof gate;
  computeBaseline: typeof computeBaseline;
  zScores: typeof zScores;
  recentMean: typeof recentMean;
};

const DEFAULT_DEPS: SummaryDeps = { detectSignal, gate, computeBaseline, zScores, recentMean };

/** One field 8 row. There is no target field, so no target can be rendered. (Req 2.4) */
export type MeasureRow = {
  feature: Feature;
  label: string;
  baselineMean: number | null;
  recentMean: number | null;
  z: number | null; // null renders NOT_AVAILABLE_TEXT (Req 2.3)
};

export type SummaryFieldNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export type TextFieldKey =
  | 'subject'
  | 'intro'
  | 'person'
  | 'from'
  | 'focus'
  | 'family_history'
  | 'dates'
  | 'data_sources'
  | 'what_changed'
  | 'discuss'
  | 'rtk'
  | 'questions'
  | 'footer';

export type SummaryField =
  | { n: 8; key: 'measures'; label: 'Measures'; rows: MeasureRow[] }
  | { n: Exclude<SummaryFieldNumber, 8>; key: TextFieldKey; label: string; text: string };

export type ClinicianSummary = {
  fields: SummaryField[]; // exactly 14, ordered n = 1..14 (Req 1.2)
  synthetic: boolean; // drives the Synthetic_Label (Req 4.1–4.3)
};

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** A trimmed, non-blank string, or null. */
function present(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** A finite number, or null. Sanitizes values from the baseline modules; computes nothing. */
function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** "M. Linden", "M.", "Linden" or "Name not provided". Never throws. (Req 1.3, 1.4) */
function shortName(first: string | null, last: string | null): string {
  if (first && last) return `${first[0]}. ${last}`;
  if (first) return `${first[0]}.`;
  if (last) return last;
  return 'Name not provided';
}

/** Whole weeks from `from` to `to` (ISO dates), or null when either is unparsable. */
function weeksBetween(from: string, to: string): number | null {
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  return Number.isFinite(days) ? Math.round(days / 7) : null;
}

/**
 * True only when a signal exists and `gate()` returns `includeInSummary`
 * exactly `true` without throwing. Anything else counts as closed. (Req 3.4, 3.5)
 */
function gateOpen(deps: SummaryDeps, signal: ChangeSignal | null, rtkSetting: unknown): boolean {
  if (signal === null || signal === undefined) return false;
  try {
    return deps.gate(signal, rtkSetting)?.includeInSummary === true;
  } catch {
    return false;
  }
}

/** The z-scores of the last entry for `latest`, or null. */
function latestWeekZ(
  weeks: ReturnType<typeof zScores>,
  latest: string,
): ReturnType<typeof zScores>[number]['z'] | null {
  for (let i = weeks.length - 1; i >= 0; i -= 1) {
    if (weeks[i].weekStart === latest) return weeks[i].z;
  }
  return null;
}

/** The change signal, or null when detection fails. */
function signalOf(deps: SummaryDeps, rows: readonly WeeklyFeatureRow[]): ChangeSignal | null {
  try {
    return deps.detectSignal(rows) ?? null;
  } catch {
    return null;
  }
}

/**
 * Field 10 when the gate is open: only the measures, the timeframe and the
 * change amount, in a fixed template with no interpretation. (Req 3.1, 3.3)
 */
function changeText(signal: ChangeSignal, baselineStart: string | null, measures: MeasureRow[]): string {
  const listed = Array.isArray(signal.features) ? signal.features : [];
  const moved = measures
    .filter((row) => listed.includes(row.feature))
    .map((row) =>
      row.z === null
        ? `${row.label} (z not available)`
        : `${row.label} (z ${row.z.toFixed(1)}, ${row.z >= 0 ? 'higher' : 'lower'})`,
    );

  const weeks = baselineStart === null ? null : weeksBetween(baselineStart, signal.firstWeek);
  const since =
    weeks === null
      ? `Since the week of ${signal.firstWeek}`
      : `Since the week of ${signal.firstWeek}, ${weeks} weeks after the baseline start on ${baselineStart}`;

  return `${since}, these measures moved away from the person's own baseline: ${
    moved.length > 0 ? moved.join('; ') : 'none listed'
  }.`;
}

/* -------------------------------------------------------------------------- */
/* buildSummary                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Assembles the clinician summary: exactly 14 fields in order, and whether any
 * data is synthetic. Pure; `deps` default to the real health-baseline modules.
 * (Req 1–4 / P3)
 */
export function buildSummary(input: SummaryInput, deps: SummaryDeps = DEFAULT_DEPS): ClinicianSummary {
  const { profile, rows, summaryDate } = input;

  const weekStarts = rows
    .map((row) => row.weekStart)
    .filter((w): w is string => typeof w === 'string')
    .sort();
  const baselineStart = weekStarts[0] ?? null;
  const latest = weekStarts[weekStarts.length - 1] ?? null;

  const signal = signalOf(deps, rows);
  const open = gateOpen(deps, signal, profile.rtkSetting);

  // Field 8: every value from the baseline modules. (Req 2.2, 2.5)
  const baseline = deps.computeBaseline(rows);
  const latestZ = latest === null ? null : latestWeekZ(deps.zScores(rows), latest);
  const measures: MeasureRow[] = SUMMARY_FEATURE_ORDER.map((feature) => ({
    feature,
    label: FEATURE_LABELS[feature],
    baselineMean: finite(baseline?.[feature]?.mean),
    recentMean: rows.length === 0 ? null : finite(deps.recentMean(rows, feature, 4)),
    z: finite(latestZ?.[feature]),
  }));

  // Synthetic unless the profile and every row say otherwise. (Req 4.2, 4.3)
  const synthetic = !(profile.synthetic === false && rows.every((row) => row.synthetic === false));

  const first = present(profile.firstName);
  const last = present(profile.lastName);
  const fullName = [first, last].filter(Boolean).join(' ') || 'Name not provided';
  const dateOfBirth = present(profile.dateOfBirth);
  const contact = present(input.contact);

  // Field 6 names the relative's condition and, when known, the relation.
  const condition = FAMILY_CONDITION_TEXT.get(profile.familyHistory);
  const relation = present(profile.familyHistoryRelation);
  const familyHistory = condition
    ? relation
      ? `${condition} (${relation})`
      : condition
    : (FAMILY_HISTORY_OTHER_TEXT.get(profile.familyHistory) ?? NONE_REPORTED_TEXT);

  const speech = rows.some(
    (r) => finite(r.vocabulary_diversity) !== null || finite(r.mean_sentence_length) !== null || finite(r.filler_rate) !== null,
  );
  const wearable = rows.some((r) => finite(r.sleep_hours) !== null || finite(r.active_minutes) !== null);
  const sources = [speech ? 'voice check-ins' : null, wearable ? 'a wearable' : null].filter(Boolean).join(' and ');
  const syntheticText = synthetic ? 'Includes synthetic data.' : 'No synthetic data.';
  const dataSources =
    rows.length === 0
      ? `No weekly data yet. ${syntheticText}`
      : `${rows.length} weeks of data from ${sources || 'no recorded source'}. ${syntheticText}`;

  const discuss = typeof input.discussText === 'string' && input.discussText.trim() !== '' ? input.discussText : null;

  const fields: SummaryField[] = [
    {
      n: 1,
      key: 'subject',
      label: 'Subject',
      text: `iamyou Care Summary, ${open ? 'Change noticed' : 'Update'}, ${shortName(first, last)}`,
    },
    { n: 2, key: 'intro', label: 'Intro', text: SUMMARY_INTRO_TEXT },
    {
      n: 3,
      key: 'person',
      label: 'Person',
      text: dateOfBirth ? `${fullName}, born ${dateOfBirth}` : fullName,
    },
    { n: 4, key: 'from', label: 'From', text: `iamyou · iamyou.si · ${contact ?? NO_CONTACT_TEXT}` },
    { n: 5, key: 'focus', label: 'Focus', text: FOCUS_TEXT },
    {
      n: 6,
      key: 'family_history',
      label: 'Family history',
      text: familyHistory,
    },
    {
      n: 7,
      key: 'dates',
      label: 'Baseline start and summary date',
      text: `Baseline start: ${baselineStart ?? 'No data yet'} · Summary date: ${summaryDate}`,
    },
    { n: 8, key: 'measures', label: 'Measures', rows: measures },
    { n: 9, key: 'data_sources', label: 'Data sources', text: dataSources },
    {
      n: 10,
      key: 'what_changed',
      label: 'What changed',
      text: open && signal !== null ? changeText(signal, baselineStart, measures) : NO_CHANGE_TEXT,
    },
    {
      n: 11,
      key: 'discuss',
      label: 'What the person would like to discuss',
      text: discuss ?? NOTHING_ADDED_TEXT,
    },
    {
      n: 12,
      key: 'rtk',
      label: 'Right-not-to-know setting',
      text: RTK_TEXT.get(profile.rtkSetting) ?? RTK_UNKNOWN_TEXT,
    },
    { n: 13, key: 'questions', label: 'Questions', text: contact ?? NO_CONTACT_TEXT },
    { n: 14, key: 'footer', label: 'Footer', text: NOT_A_DIAGNOSIS_FOOTER },
  ];

  return { fields, synthetic };
}
