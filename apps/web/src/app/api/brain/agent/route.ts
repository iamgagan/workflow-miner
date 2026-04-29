import { createClient } from "@/lib/supabase/server";
import { streamText, tool, stepCountIs, convertToModelMessages, type UIMessage } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { NextResponse } from "next/server";
import { inngest } from "@/inngest/client";

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const organizationId =
    (user.app_metadata as Record<string, unknown>)?.organization_id as string | undefined ?? user.id;
  const { messages } = (await req.json()) as { messages: UIMessage[] };

  const result = streamText({
    model: openai("gpt-4o"),
    system: "You are the Company Brain Agent. You have access to the company's entire knowledge graph, including Slack messages, Emails, Linear tickets, and Google Calendar events. Your job is to answer questions using ONLY the facts retrieved from the search tool. If you are asked to draft something, use the context. If you don't know the answer after searching, say you don't know.",
    messages: await convertToModelMessages(messages),
    tools: {
      searchCompanyKnowledge: tool({
        description: "Search the company's knowledge graph and communications history.",
        inputSchema: z.object({
          query: z.string().describe("The search query to embed and look up in the vector database."),
        }),
        execute: async ({ query }) => {
          // Generate embedding for the query
          const { OpenAI } = await import("openai");
          const oai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
          const response = await oai.embeddings.create({
            model: "text-embedding-3-small",
            input: query,
            encoding_format: "float",
          });
          const embedding = response.data[0].embedding;

          // Call Postgres RPC for vector similarity search
          // Assumes `match_timeline_entries` RPC function exists in Supabase
          const { data, error } = await supabase.rpc("match_timeline_entries", {
            query_embedding: embedding,
            match_threshold: 0.7,
            match_count: 10,
            org_id: organizationId,
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
          // Verify the pattern belongs to this org before dispatching.
          const { data: pattern, error: patternError } = await supabase
            .from("brain_pages")
            .select("id, slug, title, type")
            .eq("organization_id", organizationId)
            .or(`slug.eq.${workflowId},id.eq.${Number.isNaN(Number(workflowId)) ? -1 : Number(workflowId)}`)
            .eq("type", "pattern")
            .maybeSingle();

          if (patternError || !pattern) {
            return { success: false, error: "Workflow pattern not found in this organization." };
          }

          // Hand the actual execution off to Inngest. The pattern/execute
          // handler is responsible for compiling the pattern → skill pack
          // and running it; this endpoint only dispatches.
          const { ids } = await inngest.send({
            name: "pattern/execute.requested",
            data: {
              organizationId,
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
        description: "List the frequent workflow patterns detected across the organization.",
        inputSchema: z.object({
          limit: z.number().optional().describe("Max patterns to return (default 20)"),
        }),
        execute: async ({ limit }) => {
          const { data, error } = await supabase
            .from("brain_pages")
            .select("id, slug, title, compiled_truth, frontmatter, updated_at")
            .eq("organization_id", organizationId)
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
      })
    },
    stopWhen: stepCountIs(5), // Allow the agent to call tools and loop back
  });

  return result.toUIMessageStreamResponse();
}
