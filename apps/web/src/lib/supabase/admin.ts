import { createLocalShimClient, type LocalShimClient } from "./local-shim";

/**
 * Desktop-only: returns the local PGlite-backed shim. In hosted mode this
 * used to issue a service-role Supabase client to bypass RLS, but desktop
 * runs under a single local user where RLS does not apply.
 */
export function createAdminClient(): LocalShimClient {
  return createLocalShimClient();
}
