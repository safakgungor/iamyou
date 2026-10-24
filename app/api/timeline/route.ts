/**
 * `GET /api/timeline` (health-baseline Req 5.6, 5.7, 7.1–7.6, 7.15, 7.16, 9.1–9.4)
 *
 * Returns the caller's weekly health timeline: their own `weekly_features` rows
 * (ascending `week_start`), per-week z-scores, per-feature baseline statistics
 * and the change signal, gated by the caller's `rtk_setting`. Nothing about the
 * caller's health history leaves the server before they opt in: an opted-out
 * caller (no profile, or `health_layer_opt_in` other than exactly `true`) gets
 * exactly `{ "opted_in": false }`, and their weekly rows are never read (D11).
 *
 * The route handler is a thin shell: it authenticates the caller (401 when
 * there is none, before any profile read) and delegates to the
 * repository-backed `getTimeline` so it can be unit-tested with
 * `InMemoryWeeklyFeatureRepository` and `InMemoryVaultRepository`.
 */

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/db/supabase-server';
import {
  SupabaseVaultRepository,
  type Profile,
  type VaultRepository,
} from '@/lib/db/vault-repository';
import {
  SupabaseWeeklyFeatureRepository,
  type WeeklyFeatureRepository,
} from '@/lib/db/weekly-feature-repository';
import type { WeeklyFeatureRow } from '@/lib/baseline';
import { buildTimeline } from '@/lib/timeline';
import {
  TimelineResponseSchema,
  type TimelineResponse,
} from '@/lib/claude/schemas';

/**
 * The profile read the routes need; satisfied by `VaultRepository`.
 * `getTimeline` reads `healthLayerOptIn` and `rtkSetting`; `getCountyCard`
 * reads only `county`.
 */
export type ProfileReader = Pick<VaultRepository, 'getProfile'>;

/**
 * The possible outcomes of `getTimeline`, mapped to HTTP status by the handler:
 *   200 — either branch of the `opted_in` discriminated union (Req 7.1–7.4, 9.1, 9.3)
 *   503 — the timeline is unavailable: a failed profile or weekly read, or a
 *         response that fails validation; no partial data (Req 7.6, 7.16)
 */
export type TimelineOutcome =
  | { status: 200; body: TimelineResponse }
  | { status: 503; body: { error: 'timeline_unavailable' } };

const UNAVAILABLE = {
  status: 503,
  body: { error: 'timeline_unavailable' },
} as const satisfies TimelineOutcome;

/**
 * The testable core of the timeline route. The order of steps is the design
 * (D11): profile read → opt-in check → weekly read → shape → validate. The
 * opt-in check returns before any `weekly_features` read, so the opted-out
 * body cannot depend on whether rows or a change signal exist. `detectSignal`
 * is reached only through `buildTimeline`, which is called only in step 4.
 */
export async function getTimeline(
  weekly: WeeklyFeatureRepository,
  profiles: ProfileReader,
  userId: string,
): Promise<TimelineOutcome> {
  // 1. Profile first. A failed read is an error, never "not opted in". (Req 7.16, 9.1)
  let profile: Profile | null;
  try {
    profile = await profiles.getProfile(userId);
  } catch {
    return UNAVAILABLE; // no opted_in, rows, z-scores, baseline or signal
  }

  // 2. Opt-in check before any weekly read. Only exactly `true` counts, so
  //    `false`, `null`, `undefined` and any non-boolean fail closed. (Req 9.1, 9.2)
  if (!profile || profile.healthLayerOptIn !== true) {
    const parsed = TimelineResponseSchema.safeParse({ opted_in: false }); // Req 9.4
    return parsed.success ? { status: 200, body: parsed.data } : UNAVAILABLE;
  }

  // 3. Opted in: read the caller's rows. A failed read returns nothing partial. (Req 7.1, 7.16)
  let rows: WeeklyFeatureRow[];
  try {
    rows = await weekly.listWeeklyFeatures(userId);
  } catch {
    return UNAVAILABLE;
  }

  // 4. Shape the opted-in body; `rtk_setting` is read from the caller's own
  //    profile at request time and gates the signal. (Req 5.6, 5.7, 7.2–7.4, 7.15, 9.3)
  const payload = buildTimeline(rows, profile.rtkSetting);

  // 5. Validate before sending; never send unvalidated values. (Req 7.6)
  const parsed = TimelineResponseSchema.safeParse(payload);
  return parsed.success ? { status: 200, body: parsed.data } : UNAVAILABLE;
}

export async function GET(): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // Req 7.5: nothing is read, and no timeline data is returned.
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Both repositories run on the request-scoped client, so RLS scopes every
  // read to the caller's own rows.
  const outcome = await getTimeline(
    new SupabaseWeeklyFeatureRepository(supabase),
    new SupabaseVaultRepository(supabase),
    user.id,
  );

  return NextResponse.json(outcome.body, { status: outcome.status });
}
