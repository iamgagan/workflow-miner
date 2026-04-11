import { createClient } from "@supabase/supabase-js";
import { createLocalShimClient, isDesktopMode } from "./local-shim";

/**
 * Creates a Supabase client using the service role key.
 * Use this only for server-side operations that need to bypass RLS
 * (e.g., writing connector tokens on behalf of a user).
 *
 * In desktop mode this returns the local PGlite-backed shim — there's no
 * RLS to bypass because everything runs under a single local user.
 */
export function createAdminClient() {
  if (isDesktopMode()) {
    return createLocalShimClient() as unknown as ReturnType<typeof createClient>;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
