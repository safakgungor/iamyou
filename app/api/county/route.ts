/**
 * `GET /api/county` (health-baseline Req 8.1–8.5, 8.12, 8.13)
 *
 * Returns the CDC PLACES short-sleep card values for the county in the
 * caller's own profile: exactly `county`, `year`, `prevalence`, `low` and
 * `high` from the single case-sensitive matching row of
 * `data/public/cdc-places-short-sleep-ma-2022.csv`, never the row's
 * `population` or any of the caller's own feature data. Anything that keeps a
 * valid card from being found yields the explicit `{ "available": false }`
 * result, which carries no numbers. The county card is population context and
 * does not depend on the health-layer opt-in.
 *
 * The route handler is a thin shell: it authenticates the caller (401 when
 * there is none, before any profile read) and delegates to `getCountyCard`,
 * which takes the profile reader and the CSV reader as parameters so it can be
 * unit-tested with `InMemoryVaultRepository` and a stub reader. The file read
 * lives here, so `lib/county.ts` stays pure.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/db/supabase-server';
import {
  SupabaseVaultRepository,
  type Profile,
} from '@/lib/db/vault-repository';
import {
  findCountyCard,
  parseShortSleepCsv,
  type ShortSleepCsvRow,
} from '@/lib/county';
import {
  CountyResponseSchema,
  type CountyResponse,
} from '@/lib/claude/schemas';
import type { ProfileReader } from '@/app/api/timeline/route';

/**
 * The possible outcomes of `getCountyCard`, mapped to HTTP status by the handler:
 *   200 — the card, or the explicit unavailable result (Req 8.1–8.3, 8.12)
 *   500 — the payload failed validation; no unvalidated values (Req 8.5, 8.13)
 */
export type CountyOutcome =
  | { status: 200; body: CountyResponse }
  | { status: 500; body: { error: 'county_unavailable' } };

const INVALID = {
  status: 500,
  body: { error: 'county_unavailable' },
} as const satisfies CountyOutcome;

/** The location of the CDC PLACES file, resolved against the repository root. (Req 8.1) */
const SHORT_SLEEP_CSV_PATH = join(
  process.cwd(),
  'data',
  'public',
  'cdc-places-short-sleep-ma-2022.csv',
);

/** Production CSV reader; re-reads the file on every request, following `lib/inbox.ts`. */
function readShortSleepCsv(): string {
  // The bundler cannot scope this runtime path; skip tracing here and ship
  // the one file through outputFileTracingIncludes instead.
  return readFileSync(/*turbopackIgnore: true*/ SHORT_SLEEP_CSV_PATH, 'utf-8');
}

/** Validates a payload before it is sent; never returns unvalidated values. (Req 8.5, 8.13) */
function respond(payload: unknown): CountyOutcome {
  const parsed = CountyResponseSchema.safeParse(payload);
  return parsed.success ? { status: 200, body: parsed.data } : INVALID;
}

/**
 * The testable core of the county route: profile read → CSV read → parse →
 * exact lookup → validate. Every failure before validation is the unavailable
 * result, which can carry no `prevalence`, `low` or `high` value.
 */
export async function getCountyCard(
  profiles: ProfileReader,
  readCsv: () => string,
  userId: string,
): Promise<CountyOutcome> {
  const unavailable = { available: false } as const;

  // 1. The caller's own profile; a failed read, a missing profile, or a null
  //    or empty county has nothing to look up. (Req 8.1, 8.3)
  let profile: Profile | null;
  try {
    profile = await profiles.getProfile(userId);
  } catch {
    return respond(unavailable);
  }
  if (!profile || profile.county === null || profile.county === '') {
    return respond(unavailable);
  }

  // 2. Read the CDC file; an unreadable file is unavailable. (Req 8.12)
  let text: string;
  try {
    text = readCsv();
  } catch {
    return respond(unavailable);
  }

  // 3. Parse; a header missing a required column is unavailable.
  const rows: ShortSleepCsvRow[] | null = parseShortSleepCsv(text);
  if (rows === null) {
    return respond(unavailable);
  }

  // 4. Exactly one case-sensitive match with valid values, or unavailable.
  //    The card never carries `population`. (Req 8.1–8.3, 8.12)
  const card = findCountyCard(rows, profile.county);
  return respond(card === null ? unavailable : { available: true, card });
}

export async function GET(): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // Req 8.4: nothing is read, and no card values are returned.
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // The request-scoped client lets RLS scope the profile read to the caller.
  const outcome = await getCountyCard(
    new SupabaseVaultRepository(supabase),
    readShortSleepCsv,
    user.id,
  );

  return NextResponse.json(outcome.body, { status: outcome.status });
}
