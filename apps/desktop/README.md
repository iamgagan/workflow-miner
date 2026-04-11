# Workflow Miner — Desktop App

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

## Troubleshooting

**The window opens but stays on the splash screen.**
The Next.js sidecar didn't start. Check the terminal you ran `pnpm desktop:dev`
in for stack traces. Common causes: port 3000 collision (the shell picks a
random free port, but if your env forces 3000 there can be a conflict), missing
`pnpm install`, missing `apps/desktop/.env.local`.

**Google OAuth fails with "redirect_uri_mismatch".**
Make sure the OAuth client in Google Cloud Console is type "Desktop
application". Web application clients require the loopback URI to be
pre-registered, which won't work with the random port the shell picks.

**`keyring` errors on Linux dev.**
Linux uses libsecret/SecretService via D-Bus. On a headless dev VM there's
no keyring backend. The desktop app is macOS-first; Linux dev is supported
for editing code but not for the full keychain flow.
