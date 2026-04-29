# Workflow Miner — Desktop App (Personal Tier)

> **Status (2026-04-29): Active — the Personal tier of the Workflow Miner product line.**
>
> The same codebase ships in two modes:
> - **Personal (this app):** native macOS, PGlite on disk, your data never leaves your Mac
> - **Team (cloud):** Vercel + Supabase deployment, shared brain across the company
>
> The renderer-side `desktop-bridge.ts` (Keychain + OAuth loopback) and the
> PGlite shim are restored and wired through dual-mode Supabase factories
> that branch on `WORKFLOW_MINER_MODE=desktop`. Tauri sets that env var
> automatically when spawning the Next.js sidecar.

The macOS desktop shell for Workflow Miner. Wraps the existing Next.js
dashboard inside a Tauri (Rust) shell, runs the brain database locally via
PGlite, and stores OAuth secrets in the macOS Keychain.

## Why a desktop app?

The hosted version of Workflow Miner asks for read access to your Gmail,
Calendar, Slack, and Linear. That's a meaningful trust ask for a SaaS. The
desktop app removes the trust problem entirely — your data never leaves your
Mac:

- The brain database lives in `~/Library/Application Support/WorkflowMiner/brain`
  as an embedded Postgres (PGlite) file. No network sync.
- OAuth refresh tokens live in the macOS Keychain via the `keyring` crate.
- The Next.js server is bound to `127.0.0.1:<random port>` and is not
  reachable from the local network.

## Architecture

```
┌────────────────────────────────────────────────────────┐
│  Tauri shell  (apps/desktop/src-tauri/src/lib.rs)      │
│                                                        │
│   ┌──────────────┐   spawns   ┌────────────────────┐  │
│   │ macOS window │◄───────────│ Next.js sidecar    │  │
│   │   webview    │            │ (apps/web)         │  │
│   └──────┬───────┘            │ port = picked free │  │
│          │ navigate           │ mode = desktop     │  │
│          ▼                    └────────┬───────────┘  │
│   http://127.0.0.1:<port>              │ writes/reads │
│                                        ▼              │
│                              ┌──────────────────────┐ │
│                              │ PGlite brain.pgdata  │ │
│                              │ ~/Library/.../brain  │ │
│                              └──────────────────────┘ │
│                                                       │
│   ┌──────────────────────────────────────────────┐    │
│   │ Tauri commands (Rust):                       │    │
│   │   keychain_set / keychain_get / _delete      │    │
│   │   oauth_loopback_listen                      │    │
│   │   server_url / open_data_dir                 │    │
│   └──────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────┘
```

The single switch that makes the existing Next.js app run locally is the
`WORKFLOW_MINER_MODE=desktop` env var. When set:

- `lib/supabase/server.ts` and `lib/supabase/admin.ts` return a PGlite-backed
  Supabase-compatible shim instead of the real Supabase client. See
  `apps/web/src/lib/supabase/local-shim.ts`.
- `middleware.ts` skips Supabase auth.
- `lib/local-brain-client.ts` is used in the sync route in place of the
  engine's hosted `BrainClient`.

Every existing API route continues to work unchanged because the shim
implements the small subset of the Supabase query builder the codebase
actually calls (`from`, `select`, `eq`, `in`, `or`, `gte`, `lt`, `order`,
`limit`, `single`, `insert`, `upsert`, plus `auth.getUser()`).

## Quick start (development)

You need a Mac, Rust ≥ 1.77, Node ≥ 20, pnpm ≥ 8, and Xcode command line
tools.

```bash
# 1. Install pnpm + Rust + Tauri CLI dependencies
brew install pnpm rustup
rustup-init -y
rustup target add aarch64-apple-darwin x86_64-apple-darwin

# 2. From the repo root
pnpm install

# 3. Configure Google OAuth (see apps/desktop/.env.example)
cp apps/desktop/.env.example apps/desktop/.env.local
$EDITOR apps/desktop/.env.local

# 4. Boot the desktop dev shell
pnpm desktop:dev
```

`desktop:dev` builds the engine, then launches Tauri in dev mode. Tauri
boots the Next.js sidecar in dev mode against your repo's source files —
hot reload works as usual, just inside the desktop window instead of a
browser tab.

The first time you connect Google, the loopback OAuth flow opens your
default browser for the consent screen. After approval, Google redirects
back to `http://127.0.0.1:<random>` which the Tauri shell captures and
exchanges server-side. Refresh tokens are then mirrored into the macOS
Keychain under the service `com.workflowminer.desktop`.

## Production build

The production bundle is a notarized `.dmg` containing:

- The Tauri Rust binary
- The precompiled Next.js standalone server (`apps/web/.next/standalone`)
- The static assets (`apps/web/.next/static`)
- The `public/` tree
- A small Node.js runtime (Tauri sidecar)

```bash
# Build the engine, web app (standalone), and Tauri bundle
pnpm desktop:build

# Universal binary for Apple Silicon + Intel
pnpm desktop:build:universal
```

The output `.dmg` lands in
`apps/desktop/src-tauri/target/release/bundle/dmg/Workflow Miner_<version>_universal.dmg`.

### Code signing + notarization

Tauri supports macOS code signing via the `signingIdentity` field in
`tauri.conf.json` and Apple's notarization API. Before shipping a public
release:

1. Get an Apple Developer ID Application certificate. Install it in your
   login keychain.
2. Set the signing identity:
   ```bash
   export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
   ```
3. Set notarization credentials (use a notary API key, NOT your Apple ID
   password):
   ```bash
   export APPLE_API_KEY="ABCD1234EF"
   export APPLE_API_KEY_PATH="/path/to/AuthKey_ABCD1234EF.p8"
   export APPLE_API_ISSUER="00000000-0000-0000-0000-000000000000"
   ```
4. Build:
   ```bash
   pnpm desktop:build:universal
   ```

Tauri will sign the `.app`, package the `.dmg`, submit it to Apple's
notary service, and staple the result. Plan for the notary submission to
take 5–15 minutes the first time.

### Auto-updater

`tauri.conf.json` has the updater plugin scaffolded but disabled
(`active: false`). When you're ready to ship updates:

1. Generate a signing key:
   ```bash
   pnpm --filter @workflow-miner/desktop tauri signer generate
   ```
2. Set `pubkey` in `tauri.conf.json` to the generated public key.
3. Set `active: true`.
4. After each `pnpm desktop:build`, upload the `.dmg`, the
   `.dmg.tar.gz.sig` signature, and a `latest.json` manifest to a release
   on https://github.com/iamgagan/workflow-miner/releases.

## Layout

```
apps/desktop/
├── package.json                    # Workspace package
├── .env.example                    # OAuth + override env vars
├── README.md                       # ← you are here
├── resources/
│   ├── splash/index.html           # Splash screen shown while sidecar boots
│   └── next/                       # (generated) Next.js standalone bundle
├── scripts/
│   ├── run-next.mjs                # Sidecar bootstrap (called by Rust)
│   └── build-next.mjs              # Pre-build helper for tauri build
└── src-tauri/
    ├── Cargo.toml
    ├── tauri.conf.json
    ├── entitlements.plist          # macOS hardened-runtime entitlements
    ├── capabilities/main.json      # Tauri permission grants
    ├── icons/                      # App icons (placeholder until real ones)
    └── src/
        ├── main.rs                 # Tauri entry point
        ├── lib.rs                  # App setup, command registration
        ├── sidecar.rs              # Next.js child process lifecycle
        ├── tokens.rs               # Keychain commands
        └── oauth.rs                # Loopback OAuth listener
```

## First-build checklist

Run this once on a new Mac before you first try `pnpm desktop:dev`. Each
line takes under a minute.

```bash
# 1. Validate the toolchain
pnpm --filter @workflow-miner/desktop doctor

# 2. Install deps (root of the repo)
pnpm install

# 3. Build the engine so @workflow-miner/engine is resolvable
pnpm --filter @workflow-miner/engine build

# 4. Configure Google OAuth
cp apps/desktop/.env.example apps/desktop/.env.local
$EDITOR apps/desktop/.env.local   # fill in GMAIL_CLIENT_ID + secret

# 5. (Optional) Regenerate icons from the SVG master. The raster
#     icons are already checked in, but if you swap source.svg you'll
#     want to refresh the output.
pnpm --filter @workflow-miner/desktop tauri icon src-tauri/icons/source.svg

# 6. Sanity-check the Rust crate compiles
cd apps/desktop/src-tauri
cargo check
cargo clippy --all-targets -- -D warnings

# 7. Launch
cd ../../..
pnpm desktop:dev
```

The `pnpm --filter @workflow-miner/desktop doctor` command is your
friend — it prints a colored checklist of what's installed, what's
missing, and the exact command to fix each gap. Re-run it whenever
something feels off.

## Troubleshooting

**The Rust crate fails to compile with a `resource path '../resources/next' doesn't exist` error.**
The placeholder `apps/desktop/resources/next/.gitkeep` should prevent this,
but if you've cleaned or never ran `pnpm install`, the directory may be
missing. `mkdir -p apps/desktop/resources/next && touch apps/desktop/resources/next/.gitkeep`
and re-run `cargo check`.

**The window opens but stays on the splash screen.**
The Next.js sidecar didn't start. Check the terminal you ran
`pnpm desktop:dev` in for stack traces. Common causes:
1. `pnpm install` wasn't run → `apps/web/node_modules/.bin/next` is missing.
2. `packages/engine/dist/` is missing → run `pnpm --filter @workflow-miner/engine build`.
3. A hard-coded `PORT=3000` env var forces a collision (the shell picks
   a random free port, but if you override it the binding may fail).
4. `apps/desktop/.env.local` is missing and the renderer can't find
   `NEXT_PUBLIC_GMAIL_CLIENT_ID` — which breaks the Connectors page but
   not the sidecar itself, so the splash should still transition.

**Google OAuth fails with `redirect_uri_mismatch`.**
Make sure the OAuth client in Google Cloud Console is type **Desktop
application**, not Web application. Web clients require the loopback URI
to be pre-registered, which won't work with the random port the shell
picks. Desktop-type clients auto-accept `http://127.0.0.1:<any-port>`.

**`cargo build` fails with `failed to open icon /.../32x32.png: No such file or directory`.**
The raster icons are checked in, but if you cloned with a filter that
skipped binary files (or deleted them) you'll need to regenerate them.
The easiest fix: `pnpm --filter @workflow-miner/desktop tauri icon src-tauri/icons/source.svg`.
Or, if you only need to unblock `cargo check` (not a bundle): use
`rsvg-convert` + `png2icns` on Linux to regenerate from `source.svg`.

**`cargo check` fails with `atk.pc` / `gdk-pixbuf-2.0.pc` not found on Linux.**
Tauri on Linux uses WebKitGTK, which needs GTK system development headers.
Install them with:

```bash
sudo apt-get install -y \
  libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev \
  librsvg2-dev libsoup-3.0-dev libsecret-1-dev
```

Not needed on macOS — Tauri uses WebKit via `wry` without system headers.

**`keyring` errors on Linux dev.**
Linux uses libsecret / SecretService via D-Bus. On a headless dev VM
there's no keyring daemon running, so `keychain_set` / `keychain_get`
errors out. The desktop app is macOS-first; Linux dev is supported for
editing code and `cargo check` but not for the full keychain flow.

**Notarization submission hangs or times out.**
Apple's notary service is occasionally slow (10-30+ minutes). If it
hangs past 30 minutes, check `xcrun notarytool info <submission-id>`
for status. Transient network failures during submission also produce
hangs — re-run `pnpm desktop:build:universal` once the network recovers.
