import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/connectors/manual-token
 *
 * Accepts a manually-entered API token for connectors that don't have an
 * OAuth flow and persists the credentials map into `connector_tokens.tokens`
 * so the sync route's `loadCredentials` resolver can find it.
 *
 * Body shape:
 *   {
 *     "provider": "slack" | "linear" | "github" | "notion" | "jira" | "outlook",
 *     "token": string,
 *     "channelIds"?: string,   // slack — comma-separated
 *     "repos"?: string,        // github — comma-separated owner/repo list
 *     "email"?: string,        // jira — account email for basic auth
 *     "domain"?: string,       // jira — e.g. "mycompany.atlassian.net"
 *     "clientId"?: string,     // outlook — Azure app client ID
 *     "clientSecret"?: string, // outlook — Azure app client secret
 *     "tenantId"?: string,     // outlook — Azure AD tenant (defaults to "common")
 *   }
 */

interface ManualTokenRequest {
  provider: "slack" | "linear" | "github" | "notion" | "jira" | "outlook";
  token: string;
  channelIds?: string;
  repos?: string;
  email?: string;
  domain?: string;
  clientId?: string;
  clientSecret?: string;
  tenantId?: string;
}

const VALID_PROVIDERS: ReadonlyArray<ManualTokenRequest["provider"]> = [
  "slack",
  "linear",
  "github",
  "notion",
  "jira",
  "outlook",
];

export async function POST(request: NextRequest) {
  let body: ManualTokenRequest;
  try {
    body = (await request.json()) as ManualTokenRequest;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.provider || !VALID_PROVIDERS.includes(body.provider)) {
    return NextResponse.json(
      {
        error: "invalid_provider",
        detail: `provider must be one of: ${VALID_PROVIDERS.join(", ")}`,
      },
      { status: 400 },
    );
  }

  if (!body.token || typeof body.token !== "string" || body.token.length < 4) {
    return NextResponse.json(
      { error: "missing_or_short_token" },
      { status: 400 },
    );
  }

  // Build the credentials map in the shape that the engine connectors
  // expect. Providers with multi-field config (Jira, Outlook) require extra
  // fields and return 400 if missing.
  const tokens: Record<string, string> = {};
  switch (body.provider) {
    case "slack":
      tokens.SLACK_BOT_TOKEN = body.token;
      if (body.channelIds) tokens.SLACK_CHANNEL_IDS = body.channelIds;
      break;
    case "linear":
      tokens.LINEAR_API_KEY = body.token;
      break;
    case "github":
      tokens.GITHUB_TOKEN = body.token;
      if (!body.repos) {
        return NextResponse.json(
          { error: "missing_repos", detail: "GitHub requires 'repos' (comma-separated owner/repo list)" },
          { status: 400 },
        );
      }
      tokens.GITHUB_REPOS = body.repos;
      break;
    case "notion":
      tokens.NOTION_TOKEN = body.token;
      break;
    case "jira":
      if (!body.email || !body.domain) {
        return NextResponse.json(
          { error: "missing_jira_fields", detail: "Jira requires 'email' and 'domain' fields" },
          { status: 400 },
        );
      }
      tokens.JIRA_API_TOKEN = body.token;
      tokens.JIRA_EMAIL = body.email;
      tokens.JIRA_DOMAIN = body.domain;
      break;
    case "outlook":
      if (!body.clientId || !body.clientSecret) {
        return NextResponse.json(
          { error: "missing_outlook_fields", detail: "Outlook requires 'clientId' and 'clientSecret' fields" },
          { status: 400 },
        );
      }
      tokens.OUTLOOK_REFRESH_TOKEN = body.token;
      tokens.OUTLOOK_CLIENT_ID = body.clientId;
      tokens.OUTLOOK_CLIENT_SECRET = body.clientSecret;
      tokens.OUTLOOK_TENANT_ID = body.tenantId ?? "common";
      break;
  }

  const client = createAdminClient();
  const userId = "local";
  const { error: upsertError } = await client
    .from("connector_tokens")
    .upsert(
      {
        user_id: userId,
        provider: body.provider,
        access_token: body.token,
        tokens,
        scopes: "",
        token_type: "Bearer",
        metadata: { source: "manual" },
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,provider" },
    );

  if (upsertError) {
    console.error("[manual-token] failed to persist", upsertError);
    return NextResponse.json(
      { error: "persist_failed", detail: upsertError.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, provider: body.provider });
}

/**
 * DELETE /api/connectors/manual-token?provider={slack|linear|google}
 *
 * Soft-disconnect a connector by clearing its credentials. The row stays
 * (so historical metadata is preserved), but the access_token / tokens
 * fields are blanked so the next sync skips it. Google is allowed here too
 * even though its happy-path is OAuth — disconnecting drops the same row.
 */
const DELETABLE_PROVIDERS = ["slack", "linear", "google", "github", "notion", "jira", "outlook"] as const;

export async function DELETE(request: NextRequest) {
  const provider = new URL(request.url).searchParams.get("provider");
  if (!provider || !DELETABLE_PROVIDERS.includes(provider as (typeof DELETABLE_PROVIDERS)[number])) {
    return NextResponse.json({ error: "invalid_provider" }, { status: 400 });
  }

  const client = createAdminClient();
  // The shim doesn't currently expose .delete(); use upsert with empty
  // tokens to effectively disable the connector. This is a soft-disconnect.
  const { error } = await client
    .from("connector_tokens")
    .upsert(
      {
        user_id: "local",
        provider,
        access_token: null,
        tokens: {},
        scopes: "",
        metadata: { source: "manual", disconnected_at: new Date().toISOString() },
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,provider" },
    );

  if (error) {
    return NextResponse.json(
      { error: "delete_failed", detail: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
