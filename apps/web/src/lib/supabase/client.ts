// Desktop-only browser stub. The PGlite-backed local-shim is Node-only
// (uses node:fs / node:os / node:path), so the client-side factory returns a
// tiny object with the same auth surface the renderer historically touched.
//
// The login/signup pages are gone and user-menu.tsx only hits `auth.signOut`
// in legacy hosted-mode branches that never activate in desktop, so this
// stub exists purely to keep any stale import resolving without crashing.

const LOCAL_USER = { id: "local", email: "local@workflow-miner.app" } as const;

export function createClient() {
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
      async getUser() {
        return { data: { user: { ...LOCAL_USER } }, error: null };
      },
      async exchangeCodeForSession() {
        return noopResult;
      },
    },
  };
}
