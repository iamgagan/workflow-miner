/**
 * GET /api/devices/status
 *
 * Returns the current quota state for a device.
 *
 * Cloud mode:    expects a Bearer token in the Authorization header,
 *                hashes + looks up in desktop_devices (admin client).
 * Desktop mode:  reads the device token from local disk via
 *                getDeviceToken() and forwards to the cloud version of
 *                this endpoint with that token. The desktop UI doesn't
 *                need to know or carry the token — the sidecar handles
 *                it transparently.
 *
 * Used by the desktop Settings page to render the "AI Features: X / 100K
 * tokens used this month" badge.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getDeviceToken } from "@/lib/device-token";
import { createHash } from "node:crypto";

export const runtime = "nodejs";

const PROXY_HOST_DEFAULT = "https://workflow-miner.vercel.app";

function proxyHost(): string {
  return (
    process.env.WORKFLOW_MINER_PROXY_URL ??
    process.env.NEXT_PUBLIC_PROXY_URL ??
    PROXY_HOST_DEFAULT
  );
}

export async function GET(req: NextRequest): Promise<Response> {
  // ── Desktop mode: forward to cloud with our locally-stored token ─────
  if (process.env.WORKFLOW_MINER_MODE === "desktop") {
    const tokenInfo = await getDeviceToken();
    if (!tokenInfo) {
      return NextResponse.json(
        {
          error: "device token unavailable",
          hint: "first launch may have failed to register against the cloud — check internet",
        },
        { status: 503 },
      );
    }
    try {
      const url = `${proxyHost().replace(/\/$/, "")}/api/devices/status`;
      const upstream = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${tokenInfo.token}` },
      });
      const body = await upstream.text();
      return new Response(body, {
        status: upstream.status,
        headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "upstream fetch failed";
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  // ── Cloud mode: direct DB read ───────────────────────────────────────
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    return NextResponse.json({ error: "missing Bearer token" }, { status: 401 });
  }
  const tokenHash = createHash("sha256").update(token).digest("hex");

  const supa = createAdminClient();
  const res = await supa
    .from("desktop_devices")
    .select(
      "device_uuid, monthly_quota_tokens, used_this_period, period_started_at, last_used_at, revoked_at",
    )
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (res.error && res.error.code !== "PGRST116") {
    return NextResponse.json(
      { error: "lookup failed", detail: res.error.message },
      { status: 500 },
    );
  }
  const device = res.data as
    | {
        device_uuid: string;
        monthly_quota_tokens: number;
        used_this_period: number;
        period_started_at: string;
        last_used_at: string | null;
        revoked_at: string | null;
      }
    | null;

  if (!device || device.revoked_at) {
    return NextResponse.json({ error: "unknown or revoked device" }, { status: 401 });
  }

  // Period rolls every 30 days from period_started_at; compute days remaining
  // so the UI can show "resets in N days".
  const periodStart = new Date(device.period_started_at).getTime();
  const periodEnd = periodStart + 30 * 24 * 60 * 60 * 1000;
  const daysRemaining = Math.max(
    0,
    Math.ceil((periodEnd - Date.now()) / (24 * 60 * 60 * 1000)),
  );

  return NextResponse.json({
    device_uuid: device.device_uuid,
    monthly_quota_tokens: device.monthly_quota_tokens,
    used_this_period: device.used_this_period,
    period_started_at: device.period_started_at,
    last_used_at: device.last_used_at,
    period_resets_in_days: daysRemaining,
  });
}
