/**
 * OpenRouter chat-completion wrapper, mode-aware.
 *
 * Cloud mode:    direct call to https://openrouter.ai with OPEN_ROUTER_API_KEY
 *                from the server env. Cloud users are quota-bounded by the
 *                Vercel deployment's hard cap on the OpenRouter dashboard.
 *
 * Desktop mode:  call to the cloud-hosted /api/llm/openrouter/chat/completions
 *                proxy with a per-install Bearer token. The proxy applies a
 *                per-device quota (see desktop_devices). This way alpha users
 *                get LLM features out of the box without bringing their own
 *                key, and your OpenRouter key never ships in the DMG.
 */

import { getDeviceToken, proxyUrl } from "./device-token";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

function isDesktopMode(): boolean {
  return process.env.WORKFLOW_MINER_MODE === "desktop";
}

export async function chatCompletion(
  messages: ChatMessage[],
  options?: {
    model?: string;
    maxTokens?: number;
    temperature?: number;
  },
): Promise<string> {
  const body = JSON.stringify({
    model: options?.model ?? "anthropic/claude-3.5-haiku",
    messages,
    max_tokens: options?.maxTokens ?? 500,
    temperature: options?.temperature ?? 0.7,
  });

  let url: string;
  let bearer: string;
  const extraHeaders: Record<string, string> = {};

  if (isDesktopMode()) {
    const tokenInfo = await getDeviceToken();
    if (!tokenInfo) {
      throw new Error(
        "device token unavailable (proxy unreachable on first launch?)",
      );
    }
    url = proxyUrl("openrouter", "chat/completions");
    bearer = tokenInfo.token;
  } else {
    const apiKey = process.env.OPEN_ROUTER_API_KEY;
    if (!apiKey) throw new Error("OPEN_ROUTER_API_KEY not set");
    url = "https://openrouter.ai/api/v1/chat/completions";
    bearer = apiKey;
    extraHeaders["HTTP-Referer"] = "https://workflow-miner.vercel.app";
    extraHeaders["X-Title"] = "Workflow Miner";
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bearer}`,
      "Content-Type": "application/json",
      ...extraHeaders,
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter error (${response.status}): ${text}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? "";
}
