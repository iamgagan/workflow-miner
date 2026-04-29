# 90-second Workflow Miner demo — recording script

> **Use this for:** the Loom you'll attach to YC application, design-partner DMs, and the X / LinkedIn launch post.
>
> **Length:** 90 seconds (60s ideal, 120s max). Past 90s, completion rate drops sharply.
>
> **Format:** screen recording, no face cam (face cam adds 30s of "let me intro myself" — skip it). Voiceover after the fact via QuickTime + iMovie or Loom's built-in.
>
> **Two-tier framing.** Workflow Miner ships in two modes from one codebase:
>   - **Personal** — native macOS app, PGlite on disk, your data never leaves your Mac
>   - **Team** — cloud, self-hosted on the company's own Supabase + Vercel, multi-user
>
> The 90s demo below leads with the **Team** tier (Cloud + MCP + Markdown export — strongest for YC's Company Brain RFS). For a personal-first audience (X, Hacker News, individual founders), reorder to lead with the Mac app and slot the cloud as the upsell — see "Variant: Personal-first" at the bottom.

---

## Pre-flight checklist (do this BEFORE you hit record)

- [ ] Reference deployment is at a clean state — sign out of all dev accounts so the URL bar shows `brain.acme.com` (or your own demo domain), not `localhost:3000`.
- [ ] Browser at 1440×900 minimum. Hide bookmarks bar, dock, notifications.
- [ ] Brain has at least 100 pages and 500 timeline entries from a real connector (Gmail or Slack). The agent's answers are only impressive if the data is real.
- [ ] One real workflow pattern of `type='pattern'` exists. Slug something memorable like `support-email-to-linear-ticket`. Title and `compiled_truth` should describe it in plain English.
- [ ] Run a Dream Cycle the night before so `compiled_truth` for the top 10 pages is fresh.
- [ ] Have a Claude Code window open in another desktop with the MCP server already configured pointing at the demo deployment.
- [ ] Pre-write the question you'll ask the brain. Pick one that has a clear, factual answer the agent can find via vector search. Avoid open-ended ones like "what should we work on next?"

## The script (3 shots, 30 seconds each)

### Shot 1 — Web chat (0:00–0:30)

**Screen:** browser at `<your-domain>/brain`. Empty state visible.

**Action:**
1. Click the input.
2. Type the question slowly enough to read: *"What did the engineering team decide about the Supabase migration last sprint?"*
3. Hit Enter.
4. Wait for the agent to call `searchCompanyKnowledge`. Tool card expands. Vector search results appear.
5. Agent streams a 2-sentence answer with source citations.

**Voiceover:**
> *"This is Workflow Miner. Every email, Slack message, Linear ticket from my company is in here, embedded into a vector store. I ask one question and the brain agent searches across all of them — here it's pulling Slack threads, Linear tickets, and emails — and gives me an answer grounded in actual evidence."*

### Shot 2 — MCP from Claude Code (0:30–1:00)

**Screen:** switch to Claude Code window. Empty conversation.

**Action:**
1. Type into Claude Code: *"Use the company-brain MCP to find what Garry decided about the Q3 roadmap."*
2. Watch Claude Code call `mcp__company-brain__search_brain`. Tool result expands.
3. Claude summarizes the answer.

**Voiceover:**
> *"Same brain, different surface. My whole engineering team has the company brain wired into Claude Code via MCP. They never leave their editor. Search, fetch pages, trigger workflows — all five tools."*

### Shot 3 — Trigger a detected workflow (1:00–1:30)

**Screen:** back to `<your-domain>/brain`.

**Action:**
1. Type: *"Trigger the support-email-to-linear-ticket workflow with parameters {customer: 'Acme', priority: 'high'}."*
2. Agent calls `triggerWorkflow`. Tool card shows the dispatched event id.
3. Cut to your Inngest dashboard (or to the GitHub repo where the markdown mirror lives — your choice).
4. Show the new commit: `wm: brain mirror 2026-04-29`.

**Voiceover:**
> *"And the brain doesn't just observe — it acts. Detected workflow patterns become callable. Here I'm dispatching a real automation. Behind the scenes, a markdown mirror of the entire brain pushes nightly to a GitHub repo I control — my data stays mine. That's Workflow Miner. Self-hosted, gbrain-compatible, in your infra. Link below."*

## Post-production (15 minutes)

- [ ] Cut any dead air longer than 0.5s.
- [ ] Add 1-second fade between the 3 shots.
- [ ] Burn in your domain at the bottom of the screen for the full duration.
- [ ] Final length should land between 75 and 95 seconds.

## Distribution targets

| Channel | Format | Pin |
|---|---|---|
| X / Twitter | 2:1 native video, ≤140s, with thread | Tag `@garrytan` and reference gbrain compatibility in tweet 1 |
| LinkedIn | Native upload (no YouTube link) | First comment links to the GitHub repo + `@workflow-miner/mcp` npm |
| YC application | Loom link in the "Demo URL" field | Make sure it's not behind a login wall |
| Design-partner DMs | Loom link with custom intro line | Different intro per recipient — never copy-paste verbatim |
| `news.ycombinator.com` Show HN | Self-hosted MP4 + GitHub link | Title format: "Show HN: Workflow Miner — gbrain for companies" |

## Headline / tagline candidates

Pick the one that matches the recipient.

- **Engineer-leaning:** *"gbrain for companies. Same schema, multi-user, self-hosted."*
- **Founder-leaning:** *"The company brain that pulls itself out of your team's actual work."*
- **YC-leaning:** *"YC F26 Company Brain RFS — this is what we shipped."*
- **Skeptic-leaning:** *"Your company's knowledge is in 8 SaaS tools. Here's it as one queryable brain you fully own."*

## What to do AFTER you publish

- Post the demo on Wednesday between 10–11am ET (highest founder-Twitter engagement).
- Set a calendar reminder for 24h after posting to reply to every comment that asks "how does it compare to X" with a direct, honest answer (don't dodge).
- Track who likes / RTs — those are your design-partner DM list.

## Variant: Personal-first script (for individual / HN / X audiences)

Same 3 shots, different opener. Frames the Mac app as the lead product and the cloud as the team upsell.

### Shot 1 — Mac app launch (0:00–0:30)

**Screen:** macOS desktop. Click the Workflow Miner `.app`. Tauri window opens to `/connectors`.

**Action:**
1. Click "Connect with Google" on the Gmail card.
2. macOS browser opens, OAuth completes via the loopback flow, Keychain prompt appears.
3. Cut to `/brain` chat. Ask: *"Summarize what I worked on this week from my emails."*
4. Streaming response with sources from real Gmail threads.

**Voiceover:**
> *"This is Workflow Miner Personal. Native Mac app. My Gmail, Slack, and Linear all sync into a brain that lives entirely on this laptop — PGlite on disk, OAuth tokens in the macOS Keychain. Nothing leaves my machine for the brain itself; OpenAI calls only happen when I ask the chat agent a question. I can verify it in Activity Monitor. That's the trust pitch — not 'we promise we don't peek,' actually nothing to peek at."*

### Shot 2 — Same brain in Claude Code (0:30–1:00)

**Screen:** Claude Code. MCP config points at `http://127.0.0.1:<port>` (the local Tauri sidecar).

**Action:**
1. Type into Claude Code: *"Use the company-brain MCP to find what I emailed Garry about last month."*
2. Claude Code calls `mcp__company-brain__search_brain`. Results appear from local PGlite.

**Voiceover:**
> *"Same brain, exposed as MCP. Every editor that speaks Model Context Protocol — Claude Code, Cursor — can query my Mac's local brain. Still nothing leaving the laptop."*

### Shot 3 — Upgrade to Team (1:00–1:30)

**Screen:** browser → `<your-company>.com` cloud deployment.

**Action:**
1. Show the Team-tier dashboard with multiple users in `/settings/api-keys`.
2. Mention: "When my whole company needs this, same codebase deploys to our own Supabase + Vercel. Five teammates, one brain, our infrastructure — Amazon never sees it."

**Voiceover:**
> *"And when your team grows, same code deploys to your own Supabase + Vercel. The brain shifts from 'on my Mac' to 'in our cloud account' — never on someone else's. That's Workflow Miner. Personal tier on the Mac App Store, Team tier as a one-click Vercel deploy. Link in the description."*
