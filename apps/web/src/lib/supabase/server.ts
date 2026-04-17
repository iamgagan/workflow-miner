import { createLocalShimClient, type LocalShimClient } from "./local-shim";

// Desktop-only: every call returns the PGlite-backed shim. There is no
// hosted Supabase path anymore, so the SSR client and its cookie handling
// are gone.
export async function createClient(): Promise<LocalShimClient> {
  return createLocalShimClient();
}
