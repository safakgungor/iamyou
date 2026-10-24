'use client';

/**
 * `app/onboarding/page.tsx` — consent & settings for new users. (Req 2)
 *
 * A single-screen form that captures the three profile choices the rest of the
 * System keys off, plus a placeholder digital-will control:
 *   - `family_history` — one of huntington | familial_alzheimers | als | none |
 *     prefer_not (Req 2.1).
 *   - `health_layer_opt_in` — boolean, defaults to `false` (Req 2.2).
 *   - `rtk_setting` — one of tell_me | doctor_only | record_only, defaults to
 *     `record_only` (Req 2.4).
 *   - a disabled placeholder control for a future digital-will setting (Req 2.5).
 *
 * Copy discipline (Req 2.6, 2.7): nothing on this screen states or implies the
 * user has, or is likely to have, any condition. The single strongest
 * health-related sentence allowed is the approved wording below, used verbatim
 * and nowhere else.
 *
 * Persistence is intentionally minimal: there is no onboarding API route in this
 * spec, so the page upserts the caller's OWN `profiles` row through the browser
 * Supabase client. That write runs under the caller's `auth.uid()`, so
 * row-level security permits writing only their own row (Req 3.4), and the
 * typed `SupabaseVaultRepository.upsertProfile` performs the camelCase →
 * snake_case mapping. On success the user is sent to the hub.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/db/supabase-browser';
import {
  SupabaseVaultRepository,
  type FamilyHistory,
  type Profile,
  type RtkSetting,
} from '@/lib/db/vault-repository';

/**
 * The approved strongest health-related sentence. Per Req 2.7 this exact string
 * is the ceiling for any health guidance on this screen; it appears once.
 */
const DOCTOR_WORDING = 'You might want to talk to your doctor about this.';

/** Family-history options with neutral, non-diagnostic labels (Req 2.1, 2.6). */
const FAMILY_HISTORY_OPTIONS: ReadonlyArray<{
  value: FamilyHistory;
  label: string;
}> = [
  { value: 'none', label: 'None that I know of' },
  { value: 'huntington', label: "Huntington's in my family" },
  { value: 'familial_alzheimers', label: "Familial Alzheimer's in my family" },
  { value: 'als', label: 'ALS in my family' },
  { value: 'prefer_not', label: 'Prefer not to say' },
];

/** Right-not-to-know options with neutral labels (Req 2.3, 2.4). */
const RTK_OPTIONS: ReadonlyArray<{ value: RtkSetting; label: string }> = [
  {
    value: 'record_only',
    label: 'Just record it — keep anything health-related in my vault',
  },
  {
    value: 'doctor_only',
    label: 'Doctor only — surface it to me only alongside talking to a doctor',
  },
  { value: 'tell_me', label: 'Tell me — I want to hear health-related signals' },
];

export default function OnboardingPage() {
  const router = useRouter();

  // Defaults enforce Req 2.2 (health_layer_opt_in=false) and Req 2.4
  // (rtk_setting=record_only) when the user changes nothing.
  const [familyHistory, setFamilyHistory] = useState<FamilyHistory>('none');
  const [healthLayerOptIn, setHealthLayerOptIn] = useState(false);
  const [rtkSetting, setRtkSetting] = useState<RtkSetting>('record_only');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const supabase = createSupabaseBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setError('Please start a session before onboarding.');
        setSaving(false);
        return;
      }

      const profile: Profile = {
        firstName: null,
        lastName: null,
        dateOfBirth: null,
        county: null,
        familyHistory,
        healthLayerOptIn,
        rtkSetting,
        digitalWill: null,
        synthetic: false,
      };

      const repo = new SupabaseVaultRepository(supabase);
      await repo.upsertProfile(user.id, profile);

      router.push('/home');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not save your settings.'
      );
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto max-w-md px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Set up your twin</h1>
      <p className="mt-2 text-sm text-[--color-muted]">
        A few preferences so your twin behaves the way you want. You can change
        any of these later.
      </p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-6">
        <fieldset className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-[--color-surface] p-4">
          <legend className="px-1 text-sm font-medium">Family history</legend>
          <p className="text-sm text-[--color-muted]">
            This context is optional and stays in your vault.
          </p>
          {FAMILY_HISTORY_OPTIONS.map((option) => (
            <label
              key={option.value}
              className="flex items-center gap-3 rounded-lg px-1 py-1 text-base"
            >
              <input
                type="radio"
                name="familyHistory"
                value={option.value}
                checked={familyHistory === option.value}
                onChange={() => setFamilyHistory(option.value)}
                className="size-4 accent-[--color-accent]"
              />
              <span>{option.label}</span>
            </label>
          ))}
        </fieldset>

        <fieldset className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-[--color-surface] p-4">
          <legend className="px-1 text-sm font-medium">Health layer</legend>
          <label className="flex items-center gap-3 rounded-lg px-1 py-1 text-base">
            <input
              type="checkbox"
              name="healthLayerOptIn"
              checked={healthLayerOptIn}
              onChange={(e) => setHealthLayerOptIn(e.target.checked)}
              className="size-4 accent-[--color-accent]"
            />
            <span>Turn on the optional health layer</span>
          </label>
          <p className="text-sm text-[--color-muted]">
            Off by default. {DOCTOR_WORDING}
          </p>
        </fieldset>

        <fieldset className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-[--color-surface] p-4">
          <legend className="px-1 text-sm font-medium">Right not to know</legend>
          <p className="text-sm text-[--color-muted]">
            How would you like your twin to handle health-related signals?
          </p>
          {RTK_OPTIONS.map((option) => (
            <label
              key={option.value}
              className="flex items-center gap-3 rounded-lg px-1 py-1 text-base"
            >
              <input
                type="radio"
                name="rtkSetting"
                value={option.value}
                checked={rtkSetting === option.value}
                onChange={() => setRtkSetting(option.value)}
                className="size-4 accent-[--color-accent]"
              />
              <span>{option.label}</span>
            </label>
          ))}
        </fieldset>

        <fieldset className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-[--color-surface] p-4">
          <legend className="px-1 text-sm font-medium">Digital will</legend>
          <p className="text-sm text-[--color-muted]">
            Decide what happens to your twin later on. Coming soon.
          </p>
          <button
            type="button"
            disabled
            className="self-start rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-400"
          >
            Set up digital will (coming soon)
          </button>
        </fieldset>

        {error ? (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={saving}
          className="w-full rounded-lg bg-[--color-accent] px-6 py-3 text-base font-medium text-white disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save and continue'}
        </button>
      </form>
    </main>
  );
}
