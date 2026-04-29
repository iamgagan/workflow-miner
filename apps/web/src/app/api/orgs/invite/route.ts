import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

interface InviteRequest {
  email: string;
  role?: "admin" | "member";
}

// POST /api/orgs/invite
// Issues an invite token for a teammate to join the caller's organization.
// Returns the invite URL the caller can share manually (email delivery is
// out of scope here; see the SMTP_* env vars and a future /api/email).
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: InviteRequest;
  try {
    body = (await request.json()) as InviteRequest;
  } catch {
    return NextResponse.json({ error: "invalid_json_body" }, { status: 400 });
  }

  if (!body.email || !body.email.includes("@")) {
    return NextResponse.json({ error: "missing_or_invalid_email" }, { status: 400 });
  }

  const organizationId =
    (user.app_metadata as Record<string, unknown>)?.organization_id as string | undefined;
  if (!organizationId) {
    return NextResponse.json({ error: "no_organization_on_user" }, { status: 400 });
  }

  const token = randomBytes(32).toString("base64url");
  const role = body.role === "admin" ? "admin" : "member";

  // Use the admin client so the insert isn't blocked by RLS — RLS on
  // org_invites only allows SELECT for org members, never INSERT.
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("org_invites")
    .insert({
      organization_id: organizationId,
      email: body.email,
      token,
      role,
      created_by: user.id,
    })
    .select("id, expires_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const origin = request.nextUrl.origin;
  const inviteUrl = `${origin}/invite/accept?token=${token}`;

  return NextResponse.json({
    inviteId: data.id,
    inviteUrl,
    expiresAt: data.expires_at,
  });
}
