import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createLocalShimClient } from "./local-shim";

type SsrClient = Awaited<ReturnType<typeof createSsrClient>>;

// Dual-mode factory.
// - WORKFLOW_MINER_MODE=desktop → PGlite-backed shim (Tauri sidecar)
// - otherwise → real @supabase/ssr server client (cloud)
//
// Returned as `SsrClient` so call sites compile cleanly. The shim is
// structurally compatible at runtime — same .from/.select/.eq/.auth/.rpc
// surface — but TS can't prove that, so we cast.
export async function createClient(): Promise<SsrClient> {
  if (process.env.WORKFLOW_MINER_MODE === "desktop") {
    return createLocalShimClient() as unknown as SsrClient;
  }
  return createSsrClient();
}

async function createSsrClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component — middleware refreshes the
            // session instead.
          }
        },
      },
    }
  );
}
