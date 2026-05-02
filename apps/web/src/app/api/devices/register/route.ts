/**
 * POST /api/devices/register
 *
 * First-launch device registration for the desktop alpha. The desktop
 * generates a stable UUID per install (stored in macOS Keychain), POSTs
 * it here, and gets back a Bearer token + initial quota.
 *
 * The token is hashed (SHA-256) before persistence — we never store the
 * raw value, just like password hashing. The plaintext is returned ONCE
 * in the response; the desktop is expected to write it to Keychain
 * immediately and never round-trip with the server again.
 *
 * Idempotency: if the same device_uuid hits this endpoint twice, the
 * second call returns 409. The desktop should only call this if no
 * token is already in its Keychain.
 *
 * No auth gate — registration is anonymous and quota-bounded
 * (100k tokens/month/device by default, set in the schema migration).
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createHash, randomBytes } from "node:crypto";

export const runtime = "nodejs";

interface RegisterBody {
  readonly device_uuid?: unknown;
  readonly platform?: unknown;
  readonly app_version?: unknown;
}

export async function POST(req: Request): Promise<Response> {
  let body: RegisterBody;
  try {
    body = (await req.json()) as RegisterBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (
    typeof body.device_uuid !== "string" ||
    body.device_uuid.length < 16 ||
    body.device_uuid.length > 128
  ) {
    return NextResponse.json(
      { error: "device_uuid (16-128 char string) required" },
      { status: 400 },
    );
  }

  const supa = createAdminClient();

  const existing = await supa
    .from("desktop_devices")
    .select("id")
    .eq("device_uuid", body.device_uuid)
    .maybeSingle();

  if (existing.error && existing.error.code !== "PGRST116") {
    return NextResponse.json(
      { error: "lookup failed", detail: existing.error.message },
      { status: 500 },
    );
  }
  if (existing.data) {
    return NextResponse.json(
      { error: "already registered for this device_uuid" },
      { status: 409 },
    );
  }

  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");

  // Per-device alpha quota. Empirical sizing from alpha.9 install: a
  // single fresh user did initial Dream Cycle (~50k) + re-mine with
  // labeling (~44k) and got within 200 tokens of the original 100k cap.
  // 250k gives ~3 such cycles + plenty of /brain chat headroom over a
  // 30-day window. Cost ceiling on the OpenRouter dashboard is the
  // ultimate floor — a single runaway user can't cost us more than $10.
  const QUOTA = 250000;

  const insert = await supa.from("desktop_devices").insert({
    device_uuid: body.device_uuid,
    token_hash: tokenHash,
    monthly_quota_tokens: QUOTA,
  });

  if (insert.error) {
    return NextResponse.json(
      { error: "registration failed", detail: insert.error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    token,
    monthly_quota_tokens: QUOTA,
    period_resets_in_days: 30,
  });
}
