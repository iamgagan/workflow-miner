/**
 * Catch-all LLM proxy.
 *
 * Routes:
 *   POST /api/llm/openrouter/chat/completions  → openrouter.ai/api/v1/chat/completions
 *   POST /api/llm/openai/chat/completions      → api.openai.com/v1/chat/completions
 *   POST /api/llm/openai/embeddings            → api.openai.com/v1/embeddings
 *
 * Auth: Bearer <device_token>. The token is hashed and looked up in the
 * desktop_devices table; the proxy refuses unknown or revoked tokens, and
 * blocks any request when the device has spent its monthly quota.
 *
 * Streaming: if upstream returns text/event-stream (i.e. payload.stream =
 * true), we pipe the SSE through a TransformStream that scrapes the
 * `usage` field from the final chunk to know how many tokens to charge
 * the device. Non-streaming responses are JSON-parsed and the usage is
 * read directly. Either way, quota is decremented after the request
 * completes via the desktop_device_spend() Postgres function.
 *
 * Why not pre-deduct an estimate? For the alpha cohort 100k tokens/month
 * is a generous budget and post-hoc spend keeps the code simple. We can
 * tighten this later if it becomes an abuse vector.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createHash } from "node:crypto";

export const runtime = "nodejs";

interface Provider {
  readonly baseUrl: string;
  readonly envKey: string;
  readonly extraHeaders?: Readonly<Record<string, string>>;
}

const PROVIDERS: Readonly<Record<string, Provider>> = {
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    envKey: "OPEN_ROUTER_API_KEY",
    extraHeaders: {
      "HTTP-Referer": "https://workflow-miner.vercel.app",
      "X-Title": "Workflow Miner",
    },
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    envKey: "OPENAI_API_KEY",
  },
};

interface RouteContext {
  readonly params: Promise<{ readonly path: readonly string[] }>;
}

export async function POST(req: NextRequest, context: RouteContext): Promise<Response> {
  // ── 1. Authenticate via Bearer device token ─────────────────────────
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    return NextResponse.json({ error: "missing Bearer token" }, { status: 401 });
  }
  const tokenHash = createHash("sha256").update(token).digest("hex");

  const supa = createAdminClient();

  const deviceRes = await supa
    .from("desktop_devices")
    .select("device_uuid, monthly_quota_tokens, used_this_period, period_started_at, revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (deviceRes.error && deviceRes.error.code !== "PGRST116") {
    return NextResponse.json(
      { error: "auth lookup failed", detail: deviceRes.error.message },
      { status: 500 },
    );
  }
  const device = deviceRes.data as
    | {
        device_uuid: string;
        monthly_quota_tokens: number;
        used_this_period: number;
        period_started_at: string;
        revoked_at: string | null;
      }
    | null;

  if (!device || device.revoked_at) {
    return NextResponse.json({ error: "unknown or revoked device" }, { status: 401 });
  }

  // Pre-flight quota check — refuses obviously-over-budget devices before
  // we burn upstream tokens. The atomic spend() call later is the source
  // of truth, so a TOCTOU race here is harmless (worst case: one extra
  // request slips through right at the cap).
  if (device.used_this_period >= device.monthly_quota_tokens) {
    return NextResponse.json(
      {
        error: "quota exceeded",
        used_this_period: device.used_this_period,
        monthly_quota_tokens: device.monthly_quota_tokens,
        period_started_at: device.period_started_at,
      },
      { status: 429 },
    );
  }

  // ── 2. Resolve provider + upstream URL ───────────────────────────────
  const { path } = await context.params;
  if (!path || path.length < 1) {
    return NextResponse.json({ error: "missing provider in path" }, { status: 400 });
  }
  const provider = PROVIDERS[path[0]];
  if (!provider) {
    return NextResponse.json(
      { error: `unknown provider: ${path[0]}` },
      { status: 404 },
    );
  }
  const upstreamKey = process.env[provider.envKey];
  if (!upstreamKey) {
    return NextResponse.json(
      { error: `provider ${path[0]} not configured on server` },
      { status: 503 },
    );
  }
  const upstreamUrl = `${provider.baseUrl}/${path.slice(1).join("/")}`;

  // ── 3. Forward the request body, injecting stream_options for streaming.
  //
  // OpenAI/OpenRouter only include `usage.total_tokens` in the FINAL SSE
  // chunk when `stream_options: { include_usage: true }` is present in the
  // request. The Vercel AI SDK's streamText doesn't send that flag by
  // default, so without injection the proxy can't see token counts on
  // streaming chats and quota tracking silently under-counts.
  const rawBody = await req.text();
  let requestBody = rawBody;
  try {
    const parsed = JSON.parse(rawBody) as Record<string, unknown>;
    if (parsed.stream === true) {
      const existing = (parsed.stream_options as Record<string, unknown> | undefined) ?? {};
      parsed.stream_options = { ...existing, include_usage: true };
      requestBody = JSON.stringify(parsed);
    }
  } catch {
    // Body wasn't JSON — pass through verbatim, no injection possible.
  }

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${upstreamKey}`,
        "Content-Type": "application/json",
        ...(provider.extraHeaders ?? {}),
      },
      body: requestBody,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "upstream fetch failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // Helper: spend tokens against the device's quota. Best-effort; we don't
  // want a logging failure to break the user's response.
  const spend = async (tokens: number): Promise<void> => {
    if (tokens <= 0) return;
    try {
      await supa.rpc("desktop_device_spend", {
        p_token_hash: tokenHash,
        p_tokens: tokens,
      });
    } catch (err) {
      console.error("[llm-proxy] spend failed:", err);
    }
  };

  // ── 4a. Streaming response ───────────────────────────────────────────
  const upstreamContentType = upstream.headers.get("content-type") ?? "";
  const isStream =
    upstreamContentType.includes("text/event-stream") ||
    upstreamContentType.includes("application/x-ndjson");

  if (isStream && upstream.body) {
    let usageTokens = 0;
    let buffer = "";
    const decoder = new TextDecoder();

    const transform = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        // Mirror chunk to client immediately
        controller.enqueue(chunk);

        // Try to scrape `usage.total_tokens` from any complete SSE line
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const parsed = JSON.parse(payload);
            const total =
              parsed?.usage?.total_tokens ??
              parsed?.usage?.completion_tokens; // fallback
            if (typeof total === "number" && total > usageTokens) {
              usageTokens = total;
            }
          } catch {
            // chunk wasn't JSON, fine — keep streaming
          }
        }
      },
      async flush() {
        await spend(usageTokens);
      },
    });

    return new Response(upstream.body.pipeThrough(transform), {
      status: upstream.status,
      headers: {
        "content-type": upstreamContentType,
        // Disable buffering on Vercel's edge cache so SSE actually streams
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      },
    });
  }

  // ── 4b. Non-streaming response ───────────────────────────────────────
  const upstreamText = await upstream.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(upstreamText);
  } catch {
    // Not JSON — pass through verbatim
    return new Response(upstreamText, {
      status: upstream.status,
      headers: { "content-type": upstreamContentType || "text/plain" },
    });
  }

  const usageTokens =
    (parsed as { usage?: { total_tokens?: number } })?.usage?.total_tokens ?? 0;
  await spend(usageTokens);

  return NextResponse.json(parsed, { status: upstream.status });
}
