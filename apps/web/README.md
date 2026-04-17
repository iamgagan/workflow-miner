# apps/web

Next.js 15 dashboard + API for Workflow Miner.

This is **not a standalone web app** — it runs as a local sidecar process
inside the macOS desktop build. The Tauri shell (`apps/desktop`) picks a free
`127.0.0.1` port, launches the Next.js server there, and points the native
webview at it. In desktop mode the app rewires itself around an embedded
Postgres (PGlite) database and the macOS Keychain via
`src/lib/supabase/local-shim.ts` and `src/lib/desktop-bridge.ts`.

**Not deployed to Vercel or any hosted environment.** There is no cloud
component. All data lives in
`~/Library/Application Support/WorkflowMiner/brain`.

## Where to go next

- Setup, running, and usage: [../../README.md](../../README.md) (repo root)
- Tauri shell architecture, signing, notarization: [../desktop/README.md](../desktop/README.md)

## Running standalone (for tests)

Mostly useful for running Playwright E2E tests against the dashboard:

```bash
pnpm --filter web dev       # next dev on http://localhost:3000
pnpm --filter web build     # produce .next/ for the Tauri bundle
pnpm --filter web test:e2e  # Playwright
```

For day-to-day development use `pnpm desktop:dev` from the repo root —
that launches the Tauri shell with the sidecar wired up correctly.

## Google OAuth (one-time setup)

Desktop mode uses the RFC 8252 installed-app flow: the Tauri shell binds a
short-lived `http://127.0.0.1:<port>` listener, opens the Google consent
page in the user's default browser, captures the authorization code from
the loopback redirect, and POSTs it to `/api/connectors/google/exchange`
for a server-side token exchange. The embedded webview is never used for
OAuth because Google blocks consent in embedded browsers.

To provision credentials:

1. Go to <https://console.cloud.google.com/apis/credentials>.
2. Create an **OAuth 2.0 Client ID** with application type **Desktop app**.
   Desktop clients accept *any* `http://127.0.0.1:*` redirect URI, so no
   redirect pre-registration is needed.
3. Enable the **Gmail API** and **Google Calendar API** on the project.
4. Add the following to `apps/web/.env.local` (and to whatever env file
   the Tauri dev shell reads):

   ```bash
   # Used by the renderer to build the authorize URL
   NEXT_PUBLIC_GMAIL_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
   # Used by /api/connectors/google/exchange for the code→token round-trip
   GMAIL_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
   GMAIL_CLIENT_SECRET=GOCSPX-xxxxxxxx
   ```

5. Restart the desktop app. Click **Connect with Google** in the
   Connectors page — consent should open in your system browser; once
   approved, you'll see a "Connected" page served by the loopback
   listener and the Connectors UI will flip Gmail + Calendar to
   **Connected** without a full reload.
