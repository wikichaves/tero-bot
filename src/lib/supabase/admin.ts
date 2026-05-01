import { createClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client using the service-role key.
 * Use ONLY in server actions / route handlers — never imported into a client
 * component or returned to the browser. Bypasses RLS, so authorization must
 * be enforced manually before each call.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing Supabase admin env vars (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).",
    );
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
