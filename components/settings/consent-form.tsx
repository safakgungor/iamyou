'use client';

/**
 * The consent & settings form (Req 2). It reads the caller's own `profiles`
 * row through the browser Supabase client, so row-level security limits it to
 * that row (Req 3.4):
 *   - a profile (the "Try as Maya" demo has one) prefills the form, and saving
 *     writes only the choices that changed, then returns to the hub;
 *   - no profile keeps the Req 2 defaults (health layer off, `record_only`)
 *     and saving creates the row;
 *   - no session at all points to `/app` instead of failing.
 */

import Link from 'next/link';
import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { isAuthRetryableFetchError } from '@supabase/supabase-js';
import { createSupabaseBrowserClient } from '@/lib/db/supabase-browser';
import { SupabaseVaultRepository, type Profile } from '@/lib/db/vault-repository';
import {
  DOCTOR_WORDING,
  FAMILY_HISTORY_OPTIONS,
  RTK_OPTIONS,
  changedSettings,
  familyAccessLine,
  profileToSave,
  settingsFrom,
  type ConsentSettings,
} from './consent';

type Load =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'error'; message: string }
  | { status: 'ready'; userId: string; profile: Profile | null; initial: ConsentSettings };

const rise = (i: number) => ({ '--i': i }) as CSSProperties;

export default function ConsentForm() {
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [settings, setSettings] = useState<ConsentSettings>(() => settingsFrom(null));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadProfile() {
      try {
        const supabase = createSupabaseBrowserClient();
        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser();
        if (!user) {
          // A network failure is an error; anything else means no session.
          if (authError && isAuthRetryableFetchError(authError)) throw authError;
          if (!cancelled) setLoad({ status: 'signed-out' });
          return;
        }

        const profile = await new SupabaseVaultRepository(supabase).getProfile(user.id);
        if (cancelled) return;
        const initial = settingsFrom(profile);
        setSettings(initial);
        setLoad({ status: 'ready', userId: user.id, profile, initial });
      } catch {
        if (!cancelled) setLoad({ status: 'error', message: 'Could not load your settings.' });
      }
    }

    loadProfile();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // Let the confirmation land before returning to the hub.
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => router.push('/home'), 1100);
    return () => clearTimeout(timer);
  }, [saved, router]);

  const ready = load.status === 'ready' ? load : null;
  const changes = ready ? changedSettings(ready.initial, settings) : {};
  const changeCount = Object.keys(changes).length;
  const isNew = ready !== null && ready.profile === null;
  const canSave = ready !== null && !saving && !saved && (isNew || changeCount > 0);
  const name = ready?.profile?.firstName;
  const familyLine = familyAccessLine(ready?.profile?.digitalWill ?? null);

  function update(patch: Partial<ConsentSettings>) {
    setSettings((s) => ({ ...s, ...patch }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || !canSave) return;
    setSaving(true);
    setError(null);

    try {
      const repo = new SupabaseVaultRepository(createSupabaseBrowserClient());
      // Merge onto the row as it is now, so fields this form does not own
      // (name, digital will, synthetic flag) are never overwritten.
      const current = await repo.getProfile(ready.userId);
      await repo.upsertProfile(ready.userId, profileToSave(current, settings, changes));
      setSaved(true);
    } catch {
      setError('Could not save your settings. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-6 px-5 pb-16 pt-6">
      <nav className="flex items-center justify-between">
        <Link href="/home" className="label transition-colors hover:text-ink">
          ← Today
        </Link>
        {ready?.profile?.synthetic && (
          <span className="rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted shadow-[inset_0_0_0_1px_var(--color-line)]">
            Synthetic data
          </span>
        )}
      </nav>

      <header className="rise">
        <p className="label text-cyan-ink">{name ? `${name}'s choices` : 'Your choices'}</p>
        <h1 className="mt-3 text-[36px] font-light leading-[0.95] tracking-[-0.04em]">Consent &amp; settings</h1>
        <p className="mt-4 text-[15px] leading-snug text-muted">
          What your twin may learn, and who hears about a change. Change it any time.
        </p>
      </header>

      {load.status === 'loading' && (
        <p aria-busy="true" className="glass rise p-5 text-[15px] text-muted" style={rise(1)}>
          Loading your settings…
        </p>
      )}

      {load.status === 'signed-out' && (
        <section className="glass rise flex flex-col gap-4 p-5" style={rise(1)}>
          <div className="flex flex-col gap-1">
            <p className="text-[17px] font-medium">No session yet.</p>
            <p className="text-[15px] leading-snug text-muted">
              Start the demo as Maya to see her choices and change them.
            </p>
          </div>
          <Link
            href="/app"
            className="tap inline-flex h-12 items-center justify-center gap-2 rounded-full bg-ink text-[15px] font-medium text-white hover:bg-cyan-ink"
          >
            Try as Maya <span aria-hidden="true">→</span>
          </Link>
        </section>
      )}

      {load.status === 'error' && (
        <section className="glass rise flex flex-col gap-4 p-5" style={rise(1)}>
          <p role="alert" className="text-[15px] text-red-700">
            {load.message}
          </p>
          <button
            type="button"
            onClick={() => {
              setLoad({ status: 'loading' });
              setAttempt((n) => n + 1);
            }}
            className="tap h-11 self-start rounded-full px-5 text-sm font-medium shadow-[inset_0_0_0_1px_var(--color-line)]"
          >
            Try again
          </button>
        </section>
      )}

      {ready && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <fieldset disabled={saving || saved} className="flex min-w-0 flex-col gap-4">
            <section className="glass rise p-5" style={rise(1)}>
              <p id="family-history" className="label">
                Family history
              </p>
              <div role="radiogroup" aria-labelledby="family-history" className="mt-3 flex flex-wrap gap-2">
                {FAMILY_HISTORY_OPTIONS.map((o) => (
                  <Choice
                    key={o.value}
                    name="familyHistory"
                    value={o.value}
                    checked={settings.familyHistory === o.value}
                    onChange={() => update({ familyHistory: o.value })}
                    className="rounded-full px-4 py-2 text-[14px]"
                    on="bg-ink text-white"
                    off="bg-white/70 text-ink shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-white"
                  >
                    {o.label}
                  </Choice>
                ))}
              </div>
              <p className="mt-3 text-[14px] leading-snug text-muted">Optional. It stays in your vault.</p>
            </section>

            <section className="glass rise p-5" style={rise(2)}>
              <p id="health-layer" className="label">
                Health layer
              </p>
              <div
                role="radiogroup"
                aria-labelledby="health-layer"
                className="mt-3 grid grid-cols-2 gap-1 rounded-full bg-ink/5 p-1"
              >
                {[false, true].map((value) => (
                  <Choice
                    key={String(value)}
                    name="healthLayerOptIn"
                    value={value ? 'on' : 'off'}
                    checked={settings.healthLayerOptIn === value}
                    onChange={() => update({ healthLayerOptIn: value })}
                    className="rounded-full py-2.5 text-center text-[15px] font-medium"
                    on="bg-white text-ink shadow-[0_2px_10px_-4px_rgb(24_33_46/0.35)]"
                    off="text-muted hover:text-ink"
                  >
                    {value ? 'On' : 'Off'}
                  </Choice>
                ))}
              </div>
              <p className="mt-3 text-[14px] leading-snug text-muted">
                Learns your usual speech and sleep, so a change can be noticed early.
              </p>
              <p className="mt-2 text-[13px] leading-snug text-muted">Not sure? {DOCTOR_WORDING}</p>
            </section>

            <section className="glass rise p-5" style={rise(3)}>
              <p id="rtk" className="label">
                Right not to know
              </p>
              <p className="mt-1 text-[17px] font-medium tracking-[-0.01em]">Who hears about a change?</p>
              <div role="radiogroup" aria-labelledby="rtk" className="mt-3 flex flex-col gap-2">
                {RTK_OPTIONS.map((o) => {
                  const checked = settings.rtkSetting === o.value;
                  return (
                    <Choice
                      key={o.value}
                      name="rtkSetting"
                      value={o.value}
                      checked={checked}
                      onChange={() => update({ rtkSetting: o.value })}
                      className="flex items-start gap-3 rounded-2xl p-4"
                      on="bg-white shadow-[inset_0_0_0_1.5px_var(--color-ink)]"
                      off="bg-white/50 shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-white/80"
                    >
                      <span
                        aria-hidden="true"
                        className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ${
                          checked ? 'bg-ink' : 'shadow-[inset_0_0_0_1.5px_var(--color-line)]'
                        }`}
                      >
                        {checked && <span className="h-2 w-2 rounded-full bg-white" />}
                      </span>
                      <span className="flex flex-col gap-0.5">
                        <span className="flex items-baseline gap-2">
                          <span className="text-[16px] font-medium">{o.label}</span>
                          {o.value === 'record_only' && <span className="label text-[10px]">Default</span>}
                        </span>
                        <span className="text-[14px] leading-snug text-muted">{o.detail}</span>
                      </span>
                    </Choice>
                  );
                })}
              </div>
              {!settings.healthLayerOptIn && (
                <p className="mt-3 text-[13px] leading-snug text-muted">Applies once the health layer is on.</p>
              )}
            </section>

            <section className="glass rise p-5" style={rise(4)}>
              <p className="label">Digital will</p>
              <p className="mt-1 text-[17px] font-medium tracking-[-0.01em]">Family mode</p>
              {familyLine ? (
                <>
                  <p className="mt-1 text-[14px] leading-snug text-muted">
                    {familyLine} Your twin answers only from your own words.
                  </p>
                  <Link
                    href="/family"
                    className="tap mt-3 inline-flex h-10 items-center gap-2 rounded-full bg-white/70 px-4 text-sm font-medium shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-white"
                  >
                    Open family mode <span aria-hidden="true">→</span>
                  </Link>
                </>
              ) : (
                <p className="mt-1 text-[14px] leading-snug text-muted">No one can ask your twin how you think.</p>
              )}
            </section>
          </fieldset>

          <div className="rise flex flex-col gap-3 pt-2" style={rise(5)}>
            {error && (
              <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={!canSave}
              className={`tap inline-flex h-14 items-center justify-center gap-2 rounded-full text-[16px] font-medium text-white shadow-[0_14px_30px_-16px_rgb(24_33_46/0.7)] disabled:cursor-default ${
                saved ? 'bg-cyan-ink' : 'bg-ink hover:bg-cyan-ink disabled:opacity-40 disabled:hover:bg-ink'
              }`}
            >
              {saved ? 'Saved ✓' : saving ? 'Saving…' : isNew ? 'Save and continue' : 'Save changes'}
            </button>
            <p role="status" className="text-center text-[13px] text-muted">
              {saved
                ? 'Saved. Taking you back to Today.'
                : isNew
                  ? 'Nothing is stored until you save.'
                  : changeCount > 0
                    ? `${changeCount} unsaved ${changeCount === 1 ? 'change' : 'changes'}`
                    : 'Up to date'}
            </p>
          </div>
        </form>
      )}
    </main>
  );
}

/** One option of a radio group: a native radio, styled as its label. */
function Choice({
  name,
  value,
  checked,
  onChange,
  className,
  on,
  off,
  children,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  className: string;
  on: string;
  off: string;
  children: ReactNode;
}) {
  return (
    <label
      className={`tap relative cursor-pointer has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-cyan-ink ${className} ${
        checked ? on : off
      }`}
    >
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} className="sr-only" />
      {children}
    </label>
  );
}
