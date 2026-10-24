/**
 * Browser-side Supabase client for the Next.js App Router.
 *
 * `createSupabaseBrowserClient` builds a `@supabase/ssr` client that runs in the
 * phone browser and reads only the **publishable** (anon) key. It is used by the
 * landing page to perform anonymous sign-in for the "Try as Maya" demo
 * (Req 1.1) before the server route seeds the vault.
 *
 * The service-role key is deliberately NEVER read here. Only the public
 * `NEXT_PUBLIC_*` variables are referenced, so nothing privileged ships to the
 * client (Req 1.4).
 */

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Creates a browser Supabase client bound to the public URL and publishable key.
 * Throws a clear error when either public environment variable is missing.
 */
export function createSupabaseBrowserClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url) {
    throw new Error('Missing required environment variable: NEXT_PUBLIC_SUPABASE_URL');
  }
  if (!key) {
    throw new Error(
      'Missing required environment variable: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'
    );
  }

  return createBrowserClient(url, key);
}
