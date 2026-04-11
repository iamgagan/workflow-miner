import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createLocalShimClient, isDesktopMode } from "./local-shim";

export async function createClient() {
  // Desktop mode: return a PGlite-backed Supabase-compatible shim.
  // No cookies, no auth — everything is local to this machine.
  if (isDesktopMode()) {
    return createLocalShimClient() as unknown as ReturnType<typeof createServerClient>;
  }

  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: any }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // The `setAll` method is called from a Server Component
            // where cookies can't be set. This can be ignored if middleware
            // refreshes user sessions.
          }
        },
      },
    }
  );
}
