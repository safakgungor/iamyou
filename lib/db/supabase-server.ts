/**
 * Request-scoped Supabase **server** client for the Next.js App Router.
 *
 * `createSupabaseServerClient` builds a `@supabase/ssr` client bound to the
 * incoming request's cookies (via `next/headers`). Because it reads the
 * caller's session cookie and uses the **publishable** (anon) key, every
 * statement issued through it runs under that caller's `auth.uid()`, so
 * row-level security enforces per-user isolation. This is the client the
 * production `SupabaseVaultRepository` runs on.
 *
 * The service-role client is deliberately NOT defined here: it bypasses RLS
 * and belongs only to the demo-seed route (task 11).
 */

import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Reads a required environment variable, throwing a clear error when missing. */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Creates a request-scoped Supabase server client that reads and writes the
 * caller's auth cookies. Must be called within a request context (App Router
 * route handler, server component, or server action) where `next/headers`
 * `cookies()` is available.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const key = requireEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');

  const cookieStore = await cookies();

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // `setAll` is called from a Server Component where mutating cookies
          // is not allowed. This can be safely ignored when the session is
          // refreshed by middleware or a route handler instead.
        }
      },
    },
  });
}
