/**
 * Consent & settings: the three profile choices the rest of the System keys
 * off (Req 2), the copy that explains them, and the pure helpers the screen
 * uses to prefill, diff and save them.
 *
 * Copy discipline (Req 2.6, 2.7): nothing here states or implies the user
 * has, or is likely to have, any condition. The single strongest
 * health-related sentence allowed is `DOCTOR_WORDING`, used verbatim and once.
 */

import type { FamilyHistory, Profile, RtkSetting } from '@/lib/db/vault-repository';

/** The approved strongest health-related sentence (Req 2.7). */
export const DOCTOR_WORDING = 'You might want to talk to your doctor about this.';

export type ConsentSettings = Pick<Profile, 'familyHistory' | 'healthLayerOptIn' | 'rtkSetting'>;

/** What a new user gets when they change nothing (Req 2.2, 2.4). */
export const DEFAULT_SETTINGS: ConsentSettings = {
  familyHistory: 'none',
  healthLayerOptIn: false,
  rtkSetting: 'record_only',
};

/** Family-history options with neutral, non-diagnostic labels (Req 2.1, 2.6). */
export const FAMILY_HISTORY_OPTIONS: ReadonlyArray<{ value: FamilyHistory; label: string }> = [
  { value: 'none', label: 'None that I know of' },
  { value: 'huntington', label: "Huntington's" },
  { value: 'familial_alzheimers', label: "Familial Alzheimer's" },
  { value: 'als', label: 'ALS' },
  { value: 'prefer_not', label: 'Prefer not to say' },
];

/** Who hears about a change, for each right-not-to-know setting (Req 2.3). */
export const RTK_OPTIONS: ReadonlyArray<{ value: RtkSetting; label: string; detail: string }> = [
  { value: 'tell_me', label: 'Me', detail: 'Your twin tells you what it noticed.' },
  { value: 'doctor_only', label: 'Only my doctor', detail: "It goes in your doctor's summary, never on your screen." },
  { value: 'record_only', label: 'No one', detail: 'It stays in your vault. Nothing is shown.' },
];

/** The form's starting point: the caller's profile, or the Req 2 defaults. */
export function settingsFrom(profile: Profile | null): ConsentSettings {
  if (!profile) return { ...DEFAULT_SETTINGS };
  return {
    familyHistory: profile.familyHistory,
    healthLayerOptIn: profile.healthLayerOptIn,
    rtkSetting: profile.rtkSetting,
  };
}

/** Only the choices that differ from where the form started. */
export function changedSettings(initial: ConsentSettings, current: ConsentSettings): Partial<ConsentSettings> {
  const changes: Partial<ConsentSettings> = {};
  if (current.familyHistory !== initial.familyHistory) changes.familyHistory = current.familyHistory;
  if (current.healthLayerOptIn !== initial.healthLayerOptIn) changes.healthLayerOptIn = current.healthLayerOptIn;
  if (current.rtkSetting !== initial.rtkSetting) changes.rtkSetting = current.rtkSetting;
  return changes;
}

/**
 * The row to write. An existing profile keeps every other field (name, digital
 * will, synthetic flag) and takes only the changed choices; a new user gets a
 * fresh profile holding exactly the form's choices.
 */
export function profileToSave(
  existing: Profile | null,
  current: ConsentSettings,
  changes: Partial<ConsentSettings>
): Profile {
  if (existing) return { ...existing, ...changes };
  return {
    firstName: null,
    lastName: null,
    dateOfBirth: null,
    county: null,
    ...current,
    digitalWill: null,
    synthetic: false,
  };
}
