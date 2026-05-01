/**
 * Offline harness: compare regex-based deriveEventType against the LLM
 * event classifier on a fixture of realistic Gmail/Slack/Linear/Calendar
 * summaries.
 *
 * Goal: see whether the LLM produces specific verbs ("issue_triaged",
 * "approval_given") in cases where the regex falls back to generic source
 * buckets ("email_received", "message_event", "issue_event"). That's the
 * "patterns aren't enticing" failure mode.
 *
 * Run:
 *   OPEN_ROUTER_API_KEY=sk-... \
 *     node --experimental-strip-types apps/web/scripts/classify-harness.ts
 *
 * Without OPEN_ROUTER_API_KEY the LLM column shows "(no key)" and only
 * regex coverage is reported.
 */

import { classifyEvents, type ClassifiableEvent } from "../src/lib/event-classifier.ts";
import { deriveEventType, GENERIC_FALLBACK_TYPES } from "../src/lib/event-type-regex.ts";

interface FixtureRow {
  readonly source: string;
  readonly summary: string;
}

/**
 * Realistic-looking summaries shaped like what real connectors produce —
 * raw email subjects, Slack message snippets, Linear issue titles, Calendar
 * invite subjects. Deliberately includes edge cases the regex misses:
 *   - Subjects without trigger keywords ("Q4 budget", "Welcome aboard")
 *   - Slack messages without "posted in" / "thread"
 *   - Linear titles that are bare nouns ("Refresh token expiry handling")
 *   - Calendar entries that are project names not meeting words
 *   - Mixed casing, typos, abbreviations
 */
const FIXTURE: readonly FixtureRow[] = [
  // Gmail — subjects only, like real Gmail API output
  { source: "gmail", summary: "Re: Q4 budget review — final numbers" },
  { source: "gmail", summary: "Fwd: Customer complaint from Acme Corp" },
  { source: "gmail", summary: "[GitHub] PR #1284 merged into main" },
  { source: "gmail", summary: "Your AWS bill for October" },
  { source: "gmail", summary: "Welcome to Workflow Miner" },
  { source: "gmail", summary: "Action required: Sign the NDA by Friday" },
  { source: "gmail", summary: "Notion comment on Q1 launch plan" },
  { source: "gmail", summary: "Stripe receipt #ch_3PqL2A" },

  // Slack — typical channel/DM messages
  { source: "slack", summary: "@here can someone unblock the staging deploy?" },
  { source: "slack", summary: "lgtm 🚢" },
  { source: "slack", summary: "Standup notes for Tue: shipped auth, blocked on review" },
  { source: "slack", summary: "Pager went off again, looks like the same DB timeout" },
  { source: "slack", summary: "Coffee chat tomorrow at 3?" },
  { source: "slack", summary: "Filed LIN-512 for the rate-limit issue we discussed" },
  { source: "slack", summary: "Decided to defer the migration to next sprint — too risky pre-launch" },

  // Linear — issue titles
  { source: "linear", summary: "Refresh token expiry handling" },
  { source: "linear", summary: "[P0] OAuth callback returns 500 for Outlook users" },
  { source: "linear", summary: "Add dark mode toggle to settings page" },
  { source: "linear", summary: "Investigate intermittent test failures in CI" },
  { source: "linear", summary: "Review feedback from Sarah on dashboard mockups" },
  { source: "linear", summary: "Sprint 24 retro action items" },

  // Calendar — invite subjects
  { source: "calendar", summary: "Weekly engineering sync" },
  { source: "calendar", summary: "1:1 with Marcus" },
  { source: "calendar", summary: "Q4 planning offsite" },
  { source: "calendar", summary: "Customer call: Acme Corp renewal" },
  { source: "calendar", summary: "Postmortem: Oct 28 outage" },

  // GitHub — webhook-shaped summaries (different source)
  { source: "github", summary: "PR #1284 opened by alice: Add Stripe webhook handler" },
  { source: "github", summary: "Workflow run failed: e2e-tests on main" },
  { source: "github", summary: "Issue #87 closed by bob" },

  // Edge cases — empty / weird
  { source: "gmail", summary: "" },
  { source: "slack", summary: "ok" },
];

const c = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
};

function pad(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n - 1) + "…";
  return s + " ".repeat(n - s.length);
}

async function main(): Promise<void> {
  console.log(`${c.bold}Classify harness — ${FIXTURE.length} fixtures${c.reset}\n`);

  const events: ClassifiableEvent[] = FIXTURE.map((f, i) => ({
    id: `fx-${i}`,
    source: f.source,
    summary: f.summary,
  }));

  // Regex pass
  const regexResults = events.map((e) => deriveEventType(e.source, e.summary));

  // LLM pass
  const hasKey = !!process.env.OPEN_ROUTER_API_KEY;
  let llmResults: Map<string, { type: string; actor: string | null; objectRef: string | null }>;
  if (hasKey) {
    process.stdout.write(c.dim + "calling LLM…" + c.reset);
    const start = Date.now();
    const classified = await classifyEvents(events, { batchSize: 25, concurrency: 3 });
    const ms = Date.now() - start;
    process.stdout.write(`\r${c.dim}LLM call complete in ${ms}ms${c.reset}\n\n`);
    llmResults = new Map(
      [...classified.entries()].map(([id, c]) => [id, { type: c.type, actor: c.actor, objectRef: c.objectRef }]),
    );
  } else {
    console.log(c.yellow + "OPEN_ROUTER_API_KEY not set — skipping LLM column\n" + c.reset);
    llmResults = new Map();
  }

  // Header
  console.log(
    c.bold +
      pad("source", 10) +
      pad("summary", 50) +
      pad("regex", 22) +
      pad("llm", 22) +
      pad("actor", 14) +
      pad("ref", 14) +
      c.reset,
  );
  console.log(c.dim + "─".repeat(132) + c.reset);

  // Stats
  let regexFallback = 0;
  let llmReturned = 0;
  let llmDifferentFromRegex = 0;

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const regex = regexResults[i];
    const llm = llmResults.get(e.id);
    const regexIsFallback = GENERIC_FALLBACK_TYPES.has(regex);
    if (regexIsFallback) regexFallback++;
    if (llm) llmReturned++;
    if (llm && llm.type !== regex) llmDifferentFromRegex++;

    const regexCol = regexIsFallback ? c.yellow + regex + c.reset : c.green + regex + c.reset;
    const llmCol = llm
      ? llm.type === regex
        ? c.dim + llm.type + c.reset
        : c.cyan + llm.type + c.reset
      : hasKey
        ? c.red + "(no result)" + c.reset
        : c.dim + "(no key)" + c.reset;

    console.log(
      pad(e.source ?? "", 10) +
        pad(e.summary || "(empty)", 50) +
        pad(stripAnsi(regexCol), 22).replace(stripAnsi(regexCol), regexCol) +
        pad(stripAnsi(llmCol), 22).replace(stripAnsi(llmCol), llmCol) +
        pad(llm?.actor ?? "—", 14) +
        pad(llm?.objectRef ?? "—", 14),
    );
  }

  console.log("\n" + c.dim + "─".repeat(132) + c.reset);
  console.log(`${c.bold}Stats${c.reset}`);
  console.log(
    `  regex generic fallback (${[...GENERIC_FALLBACK_TYPES].join(", ")}):  ` +
      `${c.yellow}${regexFallback}/${FIXTURE.length} (${pct(regexFallback, FIXTURE.length)}%)${c.reset}`,
  );
  if (hasKey) {
    console.log(
      `  llm returned a valid type:                                          ` +
        `${c.green}${llmReturned}/${FIXTURE.length} (${pct(llmReturned, FIXTURE.length)}%)${c.reset}`,
    );
    console.log(
      `  llm produced a more specific type than regex:                       ` +
        `${c.cyan}${llmDifferentFromRegex}/${FIXTURE.length} (${pct(llmDifferentFromRegex, FIXTURE.length)}%)${c.reset}`,
    );
  }
}

function pct(num: number, total: number): string {
  if (total === 0) return "0";
  return ((num * 100) / total).toFixed(0);
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
