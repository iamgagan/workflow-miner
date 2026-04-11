import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client used by the auth UI (login/signup pages)
 * and the sign-out action in the user menu.
 *
 * In desktop mode the renderer never reaches these code paths — login and
 * signup redirect to /dashboard on mount, and the sign-out menu item is
 * hidden. As a defense-in-depth measure we still return a no-op stub when
 * the public Supabase env vars are missing, so any accidental call (stale
 * closure, devtools probe, future regression) fails gracefully instead of
 * throwing on the non-null assertion.
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return createNoopBrowserClient();
  }

  return createBrowserClient(url, anonKey);
}

/**
 * Minimal stub mirroring the few methods our auth UI calls. Each one
 * returns a Promise that resolves to a "not supported" error so the form
 * shows a sensible message instead of a console crash.
 */
function createNoopBrowserClient(): ReturnType<typeof createBrowserClient> {
  const notSupported = {
    error: { message: "Auth is not available in desktop mode" },
    data: null,
  };
  const stub = {
    auth: {
      async signInWithPassword() {
        return notSupported;
      },
      async signUp() {
        return notSupported;
      },
      async signInWithOAuth() {
        return notSupported;
      },
      async signOut() {
        return { error: null };
      },
      async getUser() {
        return {
          data: { user: { id: "local", email: "local@workflow-miner.app" } },
          error: null,
        };
      },
      async exchangeCodeForSession() {
        return notSupported;
      },
    },
    from() {
      // Returning a thenable-shaped object so any chained call collapses
      // to a no-op on the next .then().
      const noop = {
        select: () => noop,
        insert: () => noop,
        upsert: () => noop,
        eq: () => noop,
        in: () => noop,
        order: () => noop,
        limit: () => noop,
        single: async () => ({ data: null, error: null }),
        then: (resolve: (v: { data: null; error: null }) => unknown) =>
          Promise.resolve({ data: null, error: null }).then(resolve),
      };
      return noop;
    },
  };
  // Safe cast: our auth UI only ever calls the methods above. Any other
  // surface would also be a bug in desktop mode.
  return stub as unknown as ReturnType<typeof createBrowserClient>;
}
