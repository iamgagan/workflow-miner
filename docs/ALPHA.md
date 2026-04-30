# Workflow Miner — alpha tester guide

Welcome, and thanks for breaking the build for us. This is a closed alpha; please don't share the download link.

## What you're getting

A Mac app that watches your work tools (Gmail, Calendar, Slack, Linear) for a few days, finds the recurring sequences you do by hand ("PR opened → ping reviewer in Slack → wait for approval → close the Linear ticket"), and turns them into Claude skills you can run from any MCP-aware editor.

**Trust pitch:** the brain runs entirely on your Mac. No cloud account, no telemetry. Your work data stays in `~/Library/Application Support/WorkflowMiner` and never leaves the device. The only network calls are (a) directly to the SaaS APIs you connect, and (b) to OpenAI when you ask the chat agent a question.

## Install (~3 minutes)

1. Download the latest `Workflow Miner_<version>_universal.dmg` from the release email.
2. Double-click the `.dmg`. Drag **Workflow Miner** into **Applications**.
3. Open **Workflow Miner** from Applications. The first launch can take ~10 seconds while the bundled Next.js sidecar starts up.

That's it. No Terminal commands, no Node install, no Gatekeeper bypass — the build is signed and notarized.

## Connecting your tools

Open **Connectors** in the sidebar. Each integration has its own setup:

### Gmail + Google Calendar (one OAuth flow covers both)

1. Click **Connect Google**.
2. A browser opens to Google's consent screen. **You'll see "Google hasn't verified this app"** — that's expected during alpha. Click **Advanced → Go to Workflow Miner (unsafe)**. We're submitting for verification; this warning goes away once approved.
3. **You must be on the tester allowlist.** If you see "Access blocked: Workflow Miner has not completed the Google verification process" or similar, ping me (gagan@) with the Google account email you're using and I'll add you within an hour.
4. Approve the requested scopes (read-only Gmail metadata + Calendar events).
5. The browser redirects back to Workflow Miner.

### Slack

1. Click **Connect Slack**.
2. You'll need a **Bot User OAuth Token** (`xoxb-…`). The fastest way: install our pre-configured Slack app from the link in the Connectors page, which gives you the token automatically.
3. Manual path (workspace admins): go to https://api.slack.com/apps → Create New App → From scratch → add scopes `channels:history`, `channels:read`, `users:read` → install to your workspace → copy the Bot User OAuth Token → paste into Workflow Miner.

### Linear

1. Click **Connect Linear**.
2. Linear → **Settings → API → Personal API keys** → **+ New API key** → name it "Workflow Miner" → copy.
3. Paste into Workflow Miner.

## What to try first

After at least one connector finishes its first sync (you'll see a green "synced" badge):

1. **Patterns tab.** Click **Mine patterns**. After ~30 seconds you'll get a list of recurring sequences mined from your last 14 days.
2. **Brain tab.** Ask things like "what did I work on yesterday?" or "what's blocking the X migration?" The chat agent answers from your local data using OpenAI for reasoning only.
3. **Dream Cycle.** Settings → "Run Dream Cycle now". This does an offline pass to compile each entity (people, projects, repos) into a "compiled truth" page — the result is what the chat agent reads from. It runs automatically once a night; the manual trigger is for impatient testers.
4. **Skills tab.** Pick a pattern, click **Export as skill**. You get a Markdown file you can drop into `~/.claude/skills/` and run from Claude Code.

## Known limitations (alpha)

- **macOS only.** Universal build — works on Intel and Apple Silicon.
- **No auto-updates yet.** When v0.1.0-alpha.3 ships, you'll get an email with the download link. Replace the .app in Applications.
- **Pattern mining is heuristic.** Some matches will be junk. Tell us which.
- **The chat agent calls OpenAI** for the LLM reasoning (your data goes in the prompt). If you'd rather it run fully local, that's on the roadmap (Ollama support post-alpha).
- **Slack ingest is read-only and shallow.** We pull message metadata, not full thread bodies. Bot tokens with `channels:history` only see public channels.
- **Single-user.** The Personal tier is one-user-per-Mac. The Team tier (multi-user, cloud) is a separate thing — ask if you're curious.

## Feedback

Please send anything — broken flows, weird patterns, "I expected X but got Y", whether the trust pitch resonates:

- **Bugs / weird stuff:** reply to the alpha invite email
- **Bigger thoughts:** book 15 min with me at <calendar-link>
- **Logs to attach when something breaks:** open Finder → `Go → Go to Folder…` → paste `~/Library/Application Support/WorkflowMiner/logs` → drop into the email

Logs are local-only and never auto-uploaded. Read them yourself first to confirm there's nothing sensitive before sending.

## Privacy disclosure (one paragraph)

Workflow Miner Personal stores all ingested data in a local PGlite database in `~/Library/Application Support/WorkflowMiner`. The only outbound network calls are: (1) to the SaaS APIs you connect (Gmail, Slack, Linear, Calendar) using the credentials you provide; (2) to OpenAI's API when you actively ask the chat agent a question — your data is included in those prompts and processed under OpenAI's API terms (not used for training when called via the API). No analytics, no crash reporting, no telemetry of any kind in this build. If you uninstall, drag `Workflow Miner.app` to the Trash and delete `~/Library/Application Support/WorkflowMiner` to remove all local data.

## Uninstall

```
rm -rf "/Applications/Workflow Miner.app"
rm -rf "$HOME/Library/Application Support/WorkflowMiner"
```

The Slack/Linear/Google tokens you provided are stored in macOS Keychain under the `com.workflowminer.desktop` service. Open **Keychain Access**, search "workflow", delete any matching entries to fully remove credentials.
