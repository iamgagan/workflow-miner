import { inngest } from "./client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import type { BrainClient as EngineBrainClient } from "@workflow-miner/engine";

// Lazy clients — created on first use, not at module load. Lets `next build`
// collect page data without env vars present and lets unit tests inject mocks.
let _supabase: SupabaseClient | null = null;
function supa(): SupabaseClient {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supabase;
}

let _openai: OpenAI | null = null;
function oai(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

async function generateEmbedding(text: string) {
  if (!text) return null;
  try {
    const response = await oai().embeddings.create({
      model: "text-embedding-3-small",
      input: text,
      encoding_format: "float",
    });
    return response.data[0].embedding;
  } catch (error) {
    console.error("Failed to generate embedding", error);
    return null;
  }
}

class CloudBrainClient {
  async putPage(page: any) {
    const embedding = await generateEmbedding(`${page.title} ${page.compiled_truth || ""}`);
    const { data, error } = await supa()
      .from("brain_pages")
      .upsert(
        {
          slug: page.slug,
          type: page.type ?? "concept",
          title: page.title,
          compiled_truth: page.compiled_truth ?? "",
          timeline: page.timeline ?? "",
          frontmatter: page.frontmatter ?? {},
          content_hash: page.content_hash ?? null,
          embedding,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "slug" }
      )
      .select();
    if (error) throw new Error(`putPage failed: ${error.message}`);
    return data[0];
  }

  async addTimelineEntry(entry: any) {
    const embedding = await generateEmbedding(`${entry.summary} ${entry.detail || ""}`);
    const { data, error } = await supa()
      .from("brain_timeline")
      .insert({
        page_id: entry.page_id,
        date: entry.date,
        source: entry.source,
        summary: entry.summary,
        detail: entry.detail ?? "",
        embedding,
      })
      .select();
    if (error) throw new Error(`addTimelineEntry failed: ${error.message}`);
    return data[0];
  }

  async addLink(link: any) {
    const { data, error } = await supa()
      .from("brain_links")
      .upsert(
        {
          from_slug: link.from_slug,
          to_slug: link.to_slug,
          link_type: link.link_type ?? "related",
          context: link.context ?? "",
        },
        { onConflict: "from_slug,to_slug,link_type" }
      )
      .select();
    if (error) throw new Error(`addLink failed: ${error.message}`);
    return data[0];
  }
}

export const syncCompanyData = inngest.createFunction(
  {
    id: "sync-company-data",
    triggers: [{ event: "company/sync.requested" }],
  },
  async ({ event, step }) => {
    const { userId, source, lookbackDays = 14 } = event.data;

    await step.run(`sync-${source}`, async () => {
      const engine = await import("@workflow-miner/engine");

      const { data: row } = await supa()
        .from("connector_tokens")
        .select("access_token, refresh_token, tokens")
        .eq("user_id", userId)
        .eq("provider", source === "calendar" || source === "gmail" ? "google" : source)
        .single();

      if (!row) {
        throw new Error(`No credentials found for ${source}`);
      }

      let credentials: Record<string, string> = {};
      if (row.tokens && typeof row.tokens === "object" && Object.keys(row.tokens).length > 0) {
        credentials = row.tokens as Record<string, string>;
      } else if (row.refresh_token) {
        const refreshToken = String(row.refresh_token);
        const env = process.env;
        switch (source) {
          case "gmail":
            credentials = {
              GMAIL_CLIENT_ID: env.GMAIL_CLIENT_ID ?? "",
              GMAIL_CLIENT_SECRET: env.GMAIL_CLIENT_SECRET ?? "",
              GMAIL_REFRESH_TOKEN: refreshToken,
              GMAIL_USER_EMAIL: env.GMAIL_USER_EMAIL ?? "",
            };
            break;
          case "calendar":
            credentials = {
              CALENDAR_CLIENT_ID: env.GMAIL_CLIENT_ID ?? env.CALENDAR_CLIENT_ID ?? "",
              CALENDAR_CLIENT_SECRET: env.GMAIL_CLIENT_SECRET ?? env.CALENDAR_CLIENT_SECRET ?? "",
              CALENDAR_REFRESH_TOKEN: refreshToken,
            };
            break;
          case "slack":
            credentials = { SLACK_BOT_TOKEN: refreshToken, SLACK_CHANNEL_IDS: env.SLACK_CHANNEL_IDS ?? "" };
            break;
          case "linear":
            credentials = { LINEAR_API_KEY: refreshToken };
            break;
          case "github":
            credentials = { GITHUB_TOKEN: refreshToken, GITHUB_REPOS: env.GITHUB_REPOS ?? "" };
            break;
          case "notion":
            credentials = { NOTION_TOKEN: refreshToken };
            break;
          case "jira":
            credentials = {
              JIRA_EMAIL: env.JIRA_EMAIL ?? "",
              JIRA_API_TOKEN: refreshToken,
              JIRA_DOMAIN: env.JIRA_DOMAIN ?? "",
            };
            break;
          case "outlook":
            credentials = {
              OUTLOOK_CLIENT_ID: env.OUTLOOK_CLIENT_ID ?? "",
              OUTLOOK_CLIENT_SECRET: env.OUTLOOK_CLIENT_SECRET ?? "",
              OUTLOOK_REFRESH_TOKEN: refreshToken,
              OUTLOOK_TENANT_ID: env.OUTLOOK_TENANT_ID ?? "common",
              OUTLOOK_USER_EMAIL: env.OUTLOOK_USER_EMAIL ?? "",
            };
            break;
        }
      }

      let connector;
      switch (source) {
        case "gmail": connector = new engine.GmailConnector(); break;
        case "calendar": connector = new engine.CalendarConnector(); break;
        case "slack": connector = new engine.SlackConnector(); break;
        case "linear": connector = new engine.LinearConnector(); break;
        case "github": connector = new engine.GitHubConnector(); break;
        case "notion": connector = new engine.NotionConnector(); break;
        case "jira": connector = new engine.JiraConnector(); break;
        case "outlook": connector = new engine.OutlookConnector(); break;
        default: throw new Error(`Unknown source: ${source}`);
      }

      const rawEvents = await connector.fetchEvents({
        credentials,
        lookbackDays,
      });

      const normalizer = new engine.Normalizer();
      const { events: normalizedEvents } = normalizer.normalize(rawEvents);

      const brainClient: EngineBrainClient = new CloudBrainClient() as unknown as EngineBrainClient;
      const ingestWriter = new engine.IngestWriter(brainClient);
      const writeResult = await ingestWriter.writeEvents(normalizedEvents);

      return {
        events: normalizedEvents.length,
        pagesCreated: writeResult.pagesCreated,
        timelineEntries: writeResult.timelineEntries,
      };
    });

    return { success: true };
  }
);

// Triggered by the brain agent's `triggerWorkflow` tool. Loads the pattern,
// logs the dispatch, writes a timeline entry. The real per-runtime adapter
// (n8n / Zapier webhook, Claude skill pack invocation) is a TODO.
export const executePattern = inngest.createFunction(
  {
    id: "execute-pattern",
    name: "Execute workflow pattern",
    triggers: [{ event: "pattern/execute.requested" }],
  },
  async ({ event, step, logger }) => {
    const { userId, patternId, patternSlug, parameters } = event.data;

    const pattern = await step.run("load-pattern", async () => {
      const { data, error } = await supa()
        .from("brain_pages")
        .select("id, slug, title, frontmatter, compiled_truth")
        .eq("id", patternId)
        .single();
      if (error) throw new Error(`pattern not found: ${error.message}`);
      return data;
    });

    const runtime: string = (pattern.frontmatter?.runtime as string) ?? "json";

    await step.run("log-dispatch", async () => {
      logger.info({
        msg: "pattern dispatched",
        userId,
        patternSlug,
        runtime,
        parameters,
      });
    });

    await step.run("write-timeline-entry", async () => {
      const { error } = await supa().from("brain_timeline").insert({
        page_id: pattern.id,
        date: new Date().toISOString(),
        source: "pattern-executor",
        summary: `Triggered "${pattern.title}" via ${runtime} runtime`,
        detail: JSON.stringify({ parameters, requestedBy: userId }, null, 2),
      });
      if (error) throw new Error(`timeline insert failed: ${error.message}`);
    });

    // TODO: real executor — switch on `runtime` and POST to the configured
    // n8n / Zapier webhook, or invoke the Claude skill pack server-side.
    return { ok: true, patternId, patternSlug, runtime };
  }
);

const ENRICH_MODEL = process.env.OPENAI_MODEL_ENRICH ?? "gpt-4o-mini";

export async function refreshCompiledTruth(page: {
  id: number;
  slug: string;
  title: string;
  compiled_truth: string | null;
  timeline: string | null;
}): Promise<string | null> {
  // Pull the most recent timeline entries to ground the summary.
  const { data: entries } = await supa()
    .from("brain_timeline")
    .select("date, source, summary, detail")
    .eq("page_id", page.id)
    .order("date", { ascending: false })
    .limit(20);

  if (!entries || entries.length === 0) {
    // No new evidence — keep the existing compiled_truth.
    return page.compiled_truth;
  }

  const evidence = entries
    .map((e: { date: string; source: string; summary: string; detail: string | null }) =>
      `- ${e.date} (${e.source}) ${e.summary}${e.detail ? ` — ${e.detail}` : ""}`)
    .join("\n");

  const prompt = `You are summarizing a knowledge-graph page about "${page.title}".
Existing summary:
${page.compiled_truth ?? "(none)"}

Recent timeline entries:
${evidence}

Write a concise 2-3 sentence summary capturing what is currently true about this entity. No preamble. No bullet points.`;

  try {
    const response = await oai().chat.completions.create({
      model: ENRICH_MODEL,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 200,
      temperature: 0.2,
    });
    return response.choices[0]?.message?.content?.trim() ?? page.compiled_truth;
  } catch (err) {
    console.error(`refreshCompiledTruth failed for page ${page.id}:`, err);
    return page.compiled_truth;
  }
}

// Nightly LLM-enrichment pass. Walks every page touched since its last
// enrichment and refreshes its compiled_truth, extracts entities, re-embeds
// if the truth changed. Bounded by DREAM_CYCLE_MAX_PAGES_PER_RUN per run.
export const dreamCycle = inngest.createFunction(
  {
    id: "dream-cycle",
    name: "Dream Cycle (LLM enrichment)",
    triggers: [
      { cron: process.env.DREAM_CYCLE_CRON ?? "0 3 * * *" },
      { event: "dream/cycle.requested" },
    ],
  },
  async ({ step }) => {
    const max = parseInt(process.env.DREAM_CYCLE_MAX_PAGES_PER_RUN ?? "500", 10);

    const stalePages = await step.run("find-stale-pages", async () => {
      const { data, error } = await supa()
        .from("brain_pages")
        .select("id, slug, type, title, compiled_truth, timeline, updated_at, last_enriched_at")
        .or("last_enriched_at.is.null,last_enriched_at.lt.updated_at")
        .order("last_enriched_at", { ascending: true, nullsFirst: true })
        .limit(max);
      if (error) throw new Error(`find-stale-pages failed: ${error.message}`);
      return data ?? [];
    });

    for (const page of stalePages) {
      await step.run(`enrich-page-${page.id}`, async () => {
        const newCompiledTruth = await refreshCompiledTruth(page);

        const updates: Record<string, unknown> = {
          last_enriched_at: new Date().toISOString(),
        };

        if (newCompiledTruth && newCompiledTruth !== page.compiled_truth) {
          updates.compiled_truth = newCompiledTruth;
          updates.embedding = await generateEmbedding(`${page.title} ${newCompiledTruth}`);
        }

        const { error } = await supa()
          .from("brain_pages")
          .update(updates)
          .eq("id", page.id);
        if (error) throw new Error(`update-page-${page.id} failed: ${error.message}`);
      });
    }

    await step.sendEvent("notify-export", {
      name: "dream/cycle.completed",
      data: { pagesEnriched: stalePages.length },
    });

    return { pagesEnriched: stalePages.length };
  }
);
