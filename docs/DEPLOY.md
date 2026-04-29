# Deploy Workflow Miner to Production

> **Target:** Vercel (web) + Supabase (DB + auth) + Inngest cloud (background jobs).
>
> **Time:** ~30 minutes for the first deployment, ~5 minutes for subsequent ones.

This is the deployment guide for a single company hosting their own Workflow Miner instance. One Supabase project = one company; their data stays in their own infrastructure.

---

## 1. Supabase setup (5 min)

1. Create a new project at <https://app.supabase.com>. Pick a region near your team.
2. Wait for the project to provision (~2 min).
3. Open the **SQL Editor**, paste the contents of [`packages/engine/src/brain/schema.sql`](../packages/engine/src/brain/schema.sql), and run it.
4. Open **Settings → API** and copy three values:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` public key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` secret key → `SUPABASE_SERVICE_ROLE_KEY` (server-only — never expose)

## 2. Configure Supabase Auth (5 min)

1. **Authentication → Providers → Email** — enable, allow magic links. Set "Confirm Email" off if you want one-click signin.
2. **Authentication → Providers → Google** — enable. You'll need a Google Cloud OAuth client:
   - Create one at <https://console.cloud.google.com/apis/credentials>
   - Authorized JavaScript origins: your Vercel domain
   - Authorized redirect URIs: `https://<your-supabase-project>.supabase.co/auth/v1/callback`
   - Paste the client ID + secret into Supabase
3. **Authentication → URL Configuration:**
   - Site URL: your production Vercel domain (e.g. `https://brain.acme.com`)
   - Additional Redirect URLs: add `https://brain.acme.com/auth/callback`
4. **Authentication → Settings → Allowed Email Domains** — set to your company's domain (e.g. `acme.com`). This is the gate that keeps your company brain to your company. Without it, anyone can sign up.

## 3. OpenAI key (1 min)

Get a key from <https://platform.openai.com/api-keys>. Verify it has access to:
- `text-embedding-3-small` (used for embeddings on every brain write)
- `gpt-4o` (used by the brain agent at `/api/brain/agent`)
- `gpt-4o-mini` (used by Dream Cycles for entity extraction + summary refresh)

Save the key as `OPENAI_API_KEY`.

## 4. Inngest cloud setup (5 min)

Inngest handles background jobs (sync, embed, dream cycle, export, pattern execute).

1. Sign up at <https://app.inngest.com> and create a new app named `workflow-miner-brain` (or whatever — must match `id` in `apps/web/src/inngest/client.ts`).
2. From your Inngest app's **Manage → Keys** page, copy:
   - Event Key → `INNGEST_EVENT_KEY`
   - Signing Key → `INNGEST_SIGNING_KEY`

For local development, you can skip these and run `npx inngest-cli@latest dev` instead.

## 5. Vercel deployment (10 min)

1. Connect this repository to Vercel via <https://vercel.com/new>.
2. **Framework preset:** Next.js (should be auto-detected).
3. **Root directory:** `apps/web` (the monorepo's web app).
4. **Build command:** Vercel detects from the package.json.
5. **Environment variables** — set these in Vercel project settings:

   | Variable | Value | Required |
   |---|---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | from Supabase | yes |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | from Supabase | yes |
   | `SUPABASE_SERVICE_ROLE_KEY` | from Supabase | yes |
   | `OPENAI_API_KEY` | from OpenAI | yes |
   | `INNGEST_EVENT_KEY` | from Inngest | for production |
   | `INNGEST_SIGNING_KEY` | from Inngest | for production |
   | `DREAM_CYCLE_CRON` | `0 3 * * *` | no, defaults to 3am UTC |
   | `DREAM_CYCLE_MAX_PAGES_PER_RUN` | `500` | no |
   | `OPENAI_MODEL_ENRICH` | `gpt-4o-mini` | no |
   | `GITHUB_EXPORT_PAT` | from GitHub PAT | optional (markdown export) |
   | `GITHUB_EXPORT_REPO` | `owner/repo` | optional |
   | `GITHUB_EXPORT_BRANCH` | `main` | no, defaults to `main` |

6. **Deploy.** First build takes ~3 minutes.

7. Once deployed, **register the Inngest webhook**:
   - In your Inngest cloud app → **Manage → Apps → Sync new app**
   - URL: `https://<your-vercel-domain>/api/inngest`
   - Inngest will probe the URL and discover the 4 functions: `sync-company-data`, `execute-pattern`, `dream-cycle`, `export-to-git`.

## 6. Smoke test (5 min)

1. Visit `https://<your-domain>/api/health` — should return `{ ok: true, checks: { web: "ok", supabase: "ok" } }`.
2. Visit `https://<your-domain>/login`, sign in with magic link or Google.
3. Visit `/brain` and ask: "what do you know about us?". Brain will say it doesn't know anything (correct — empty brain).
4. Visit `/connectors`, connect Gmail. Hit "Sync Now".
5. Wait ~1 minute. Refresh `/brain` and ask the question again — agent should now find evidence.
6. Visit `/settings` → "Run Dream Cycle now". Wait 1-2 minutes for it to walk the new pages.
7. Visit `/settings/api-keys`, generate a key. Test it:

   ```bash
   curl -X POST https://<your-domain>/api/mcp/search \
     -H "Authorization: Bearer wmk_..." \
     -H "Content-Type: application/json" \
     -d '{"query":"recent slack discussions"}'
   ```

## 7. Onboard your team (5 min)

For each teammate:
1. They visit `https://<your-domain>/login` and sign in with their company email.
2. The Supabase allowed-email-domains setting is the gate — they only get in if their email matches your configured domain.
3. (Optional) They install `@workflow-miner/mcp` in their Claude Code config — see [`packages/mcp-server/README.md`](../packages/mcp-server/README.md).

## 8. Custom domain (optional, 5 min)

1. In Vercel project settings → **Domains** → add your domain.
2. Update DNS per Vercel's instructions.
3. Once HTTPS is provisioned, **update Supabase auth URLs** to point at the new domain:
   - Site URL → your custom domain
   - Redirect URLs → `https://<custom>/auth/callback`

## 9. Production checklist

Before sharing with users:

- [ ] `NODE_ENV=production` is set on Vercel (it is by default — verify in Vercel project settings)
- [ ] `/api/seed` returns 403 (verify by hitting it on prod — should be disabled unless `ALLOW_SEED_IN_PRODUCTION=true`)
- [ ] `INNGEST_SIGNING_KEY` is set on Vercel (otherwise Inngest webhook signature verification falls open)
- [ ] Supabase **Allowed Email Domains** is set (or your auth gate is misconfigured)
- [ ] `OPENAI_API_KEY` has billing limits configured at <https://platform.openai.com/usage>
- [ ] Consider GitHub branch protection on `main` so deployment is from a known-good commit
- [ ] (Optional) Sentry DSN configured for error tracking — `@sentry/nextjs` is installed but not wired

## 10. Updating

```bash
git pull
pnpm install
# Vercel auto-deploys when you push to main.
```

If you've changed `schema.sql`, re-run the additions in your Supabase SQL editor (the file uses `IF NOT EXISTS` guards so it's safe to re-run).

## Troubleshooting

**`/api/health` returns `supabase: "down"`** — service-role key is wrong, or `NEXT_PUBLIC_SUPABASE_URL` is mistyped.

**`/login` shows "Your project's URL and API key are required"** — `NEXT_PUBLIC_SUPABASE_URL` or `_ANON_KEY` env vars not set in Vercel.

**Magic link goes to localhost instead of prod** — Site URL / Redirect URLs not configured in Supabase Auth.

**MCP server says "401 unauthorized"** — API key was created on a different deployment, or has been revoked, or is for a different user. Generate a fresh one at `/settings/api-keys`.

**Inngest functions not firing** — The Inngest cloud app didn't sync. Re-run "Sync new app" with the prod URL.

**Brain agent always says "I don't know"** — Embeddings haven't been generated yet. Hit `POST /api/dream/run` to force a Dream Cycle, or sync more connector data.

**`/dashboard` and `/patterns` show empty / errors** — these pages were built for the desktop app's data model. They may need updates to fully integrate with the cloud schema. Filed as TODO.
