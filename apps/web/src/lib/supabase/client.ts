import { createBrowserClient } from "@supabase/ssr";

// Detect Tauri at runtime via window.__TAURI__ (the desktop shell injects it).
// SSR-safe: returns false during server render.
function isTauri(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean((window as unknown as { __TAURI__?: unknown }).__TAURI__);
}

const LOCAL_USER = { id: "local", email: "local@workflow-miner.app" } as const;

// In desktop mode, return a stub auth surface — the renderer historically
// only touched .auth.signOut and .auth.getUser, both no-ops for the
// single-local-user model.
function desktopStub() {
  const noopResult = { data: null, error: null };
  return {
    auth: {
      async signOut() {
        return { error: null };
      },
      async signInWithPassword() {
        return noopResult;
      },
      async signUp() {
        return noopResult;
      },
      async signInWithOAuth() {
        return noopResult;
      },
      async signInWithOtp() {
        return noopResult;
      },
      async getUser() {
        return { data: { user: { ...LOCAL_USER } }, error: null };
      },
      async getSession() {
        return { data: { session: null }, error: null };
      },
      async exchangeCodeForSession() {
        return noopResult;
      },
      async refreshSession() {
        return noopResult;
      },
      async verifyOtp() {
        return noopResult;
      },
    },
  };
}

export function createClient() {
  if (isTauri()) {
    return desktopStub() as unknown as ReturnType<typeof createBrowserClient>;
  }
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
