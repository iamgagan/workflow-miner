import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolRequest,
} from "@modelcontextprotocol/sdk/types.js";

const WM_URL = process.env.WM_URL?.replace(/\/$/, "");
const WM_API_KEY = process.env.WM_API_KEY;

if (!WM_URL || !WM_API_KEY) {
  console.error("[@workflow-miner/mcp] WM_URL and WM_API_KEY env vars are required.");
  process.exit(1);
}

const baseHeaders = {
  Authorization: `Bearer ${WM_API_KEY}`,
  "Content-Type": "application/json",
};

async function http<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${WM_URL}${path}`, {
    method,
    headers: baseHeaders,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

const TOOLS = [
  {
    name: "search_brain",
    description: "Search the company brain (semantic vector search over pages and timeline).",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural-language search query" },
        match_count: { type: "number", description: "Max results (default 10, max 50)" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_page",
    description: "Fetch a single brain page by slug.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "The page slug, e.g. 'acme-q3-roadmap'" },
      },
      required: ["slug"],
    },
  },
  {
    name: "list_recent_activity",
    description: "List recent timeline entries, optionally filtered by source.",
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string", description: "Filter by source (gmail, slack, linear, etc.)" },
        limit: { type: "number", description: "Max entries (default 50, max 200)" },
      },
    },
  },
  {
    name: "list_patterns",
    description: "List detected workflow patterns in the company brain.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max patterns (default 20, max 100)" },
      },
    },
  },
  {
    name: "trigger_workflow",
    description: "Execute a workflow pattern by slug or id. Returns an execution event id.",
    inputSchema: {
      type: "object",
      properties: {
        workflowId: { type: "string", description: "The pattern's slug or numeric id" },
        parameters: { type: "object", description: "Parameters to pass to the workflow" },
      },
      required: ["workflowId"],
    },
  },
];

const server = new Server(
  { name: "workflow-miner", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
  const { name, arguments: args } = request.params;
  const a = (args ?? {}) as Record<string, unknown>;

  try {
    let result: unknown;
    switch (name) {
      case "search_brain":
        result = await http("POST", "/api/mcp/search", {
          query: a.query,
          match_count: a.match_count,
        });
        break;
      case "get_page":
        result = await http("GET", `/api/mcp/page/${encodeURIComponent(String(a.slug))}`);
        break;
      case "list_recent_activity": {
        const params = new URLSearchParams();
        if (a.source) params.set("source", String(a.source));
        if (a.limit) params.set("limit", String(a.limit));
        const qs = params.toString();
        result = await http("GET", `/api/mcp/activity${qs ? `?${qs}` : ""}`);
        break;
      }
      case "list_patterns": {
        const params = new URLSearchParams();
        if (a.limit) params.set("limit", String(a.limit));
        const qs = params.toString();
        result = await http("GET", `/api/mcp/patterns${qs ? `?${qs}` : ""}`);
        break;
      }
      case "trigger_workflow":
        result = await http("POST", "/api/mcp/trigger", {
          workflowId: a.workflowId,
          parameters: a.parameters ?? {},
        });
        break;
      default:
        throw new Error(`unknown tool: ${name}`);
    }

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
