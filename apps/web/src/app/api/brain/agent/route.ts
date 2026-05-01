import { createClient } from "@/lib/supabase/server";
import { streamText, tool, stepCountIs, convertToModelMessages, type UIMessage } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import { NextResponse } from "next/server";
import { inngest } from "@/inngest/client";
import { getDeviceToken, proxyUrl } from "@/lib/device-token";

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { messages } = (await req.json()) as { messages: UIMessage[] };

  // Both modes route through OpenRouter for a single bill / hard cap.
  // Cloud:    direct OpenRouter call with OPEN_ROUTER_API_KEY.
  // Desktop:  hits the cloud LLM proxy with the per-install device token;
  //           the proxy re-auths to OpenRouter and decrements quota.
  const isDesktop = process.env.WORKFLOW_MINER_MODE === "desktop";
  let openai;
  if (isDesktop) {
    const tokenInfo = await getDeviceToken();
    if (!tokenInfo) {
      return NextResponse.json(
        { error: "device token unavailable — proxy unreachable" },
        { status: 503 },
      );
    }
    openai = createOpenAI({
      apiKey: tokenInfo.token,
      baseURL: proxyUrl("openrouter"),
    });
  } else {
    openai = createOpenAI({
      apiKey: process.env.OPEN_ROUTER_API_KEY ?? "",
      baseURL: "https://openrouter.ai/api/v1",
      headers: {
        "HTTP-Referer": "https://workflow-miner.vercel.app",
        "X-Title": "Workflow Miner",
      },
    });
  }

  const result = streamText({
    model: openai("openai/gpt-4o"),
    system:
      "You are the Company Brain Agent. You have access to the company's entire knowledge graph, including Slack messages, Emails, Linear tickets, and Google Calendar events. Your job is to answer questions using ONLY the facts retrieved from the search tool. If you are asked to draft something, use the context. If you don't know the answer after searching, say you don't know.",
    messages: await convertToModelMessages(messages),
    tools: {
      searchCompanyKnowledge: tool({
        description: "Search the company's knowledge graph and communications history.",
        inputSchema: z.object({
          query: z.string().describe("The search query to embed and look up in the vector database."),
        }),
        execute: async ({ query }) => {
          const { OpenAI } = await import("openai");
          // Both modes route through OpenRouter (single provider rail);
          // desktop adds the device-token + proxy hop on the way.
          const oai = isDesktop
            ? new OpenAI({
                apiKey: (await getDeviceToken())!.token,
                baseURL: proxyUrl("openrouter"),
              })
            : new OpenAI({
                apiKey: process.env.OPEN_ROUTER_API_KEY,
                baseURL: "https://openrouter.ai/api/v1",
              });
          const response = await oai.embeddings.create({
            model: "openai/text-embedding-3-small",
            input: query,
            encoding_format: "float",
          });
          const embedding = response.data[0].embedding;

          const { data, error } = await supabase.rpc("match_timeline_entries", {
            query_embedding: embedding,
            match_threshold: 0.7,
            match_count: 10,
          });

          if (error) {
            console.error("Vector search error:", error);
            return { error: "Failed to search knowledge graph." };
          }

          return { results: data };
        },
      }),
      triggerWorkflow: tool({
        description: "Trigger a detected company workflow / automation.",
        inputSchema: z.object({
          workflowId: z.string().describe("The brain_pages slug or id of the workflow pattern to execute"),
          parameters: z.record(z.string(), z.string()).describe("Required parameters to start the workflow"),
        }),
        execute: async ({ workflowId, parameters }) => {
          const { data: pattern, error: patternError } = await supabase
            .from("brain_pages")
            .select("id, slug, title, type")
            .or(`slug.eq.${workflowId},id.eq.${Number.isNaN(Number(workflowId)) ? -1 : Number(workflowId)}`)
            .eq("type", "pattern")
            .maybeSingle();

          if (patternError || !pattern) {
            return { success: false, error: "Workflow pattern not found." };
          }

          // Hand the actual execution off to Inngest. The pattern/execute
          // handler compiles the pattern → skill pack and runs it; this
          // endpoint only dispatches.
          const { ids } = await inngest.send({
            name: "pattern/execute.requested",
            data: {
              userId: user.id,
              patternId: pattern.id,
              patternSlug: pattern.slug,
              parameters,
            },
          });

          return {
            success: true,
            executionId: ids[0],
            patternTitle: pattern.title,
            message: `Dispatched execution of "${pattern.title}". Track via execution id ${ids[0]}.`,
          };
        },
      }),
      getOrganizationPatterns: tool({
        description: "List the frequent workflow patterns detected across the company.",
        inputSchema: z.object({
          limit: z.number().optional().describe("Max patterns to return (default 20)"),
        }),
        execute: async ({ limit }) => {
          const { data, error } = await supabase
            .from("brain_pages")
            .select("id, slug, title, compiled_truth, frontmatter, updated_at")
            .eq("type", "pattern")
            .order("updated_at", { ascending: false })
            .limit(limit ?? 20);

          if (error) {
            return { error: error.message, patterns: [] };
          }

          return {
            patterns: (data ?? []).map((row) => ({
              id: row.slug,
              title: row.title,
              description: row.compiled_truth,
              frontmatter: row.frontmatter,
              lastUpdated: row.updated_at,
            })),
          };
        },
      }),
    },
    stopWhen: stepCountIs(5),
  });

  return result.toUIMessageStreamResponse();
}
