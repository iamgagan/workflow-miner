import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createLocalShimClient } from "./local-shim";

/**
 * Returns a service-role-equivalent client.
 *
 * - **Desktop mode** (`WORKFLOW_MINER_MODE=desktop`): the PGlite shim, which
 *   has no RLS to bypass since desktop runs under a single local user.
 * - **Cloud mode**: a real Supabase client configured with the service-role
 *   key, bypassing RLS for engine writes (Inngest functions, seed scripts,
 *   the connector token exchange).
 *
 * The shim is structurally compatible with SupabaseClient for the methods
 * we use; cast for TypeScript happiness.
 */
export function createAdminClient(): SupabaseClient {
  if (process.env.WORKFLOW_MINER_MODE === "desktop") {
    return createLocalShimClient() as unknown as SupabaseClient;
  }
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}
