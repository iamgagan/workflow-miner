import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

interface AcceptRequest {
  token: string;
}

// POST /api/orgs/accept
// Calls the accept_org_invite() Postgres function which atomically validates
// the token, joins the user to the org, and switches their app_metadata.
// The client must call supabase.auth.refreshSession() afterwards so the new
// JWT carries the updated organization_id.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: AcceptRequest;
  try {
    body = (await request.json()) as AcceptRequest;
  } catch {
    return NextResponse.json({ error: "invalid_json_body" }, { status: 400 });
  }

  if (!body.token) {
    return NextResponse.json({ error: "missing_token" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("accept_org_invite", {
    invite_token: body.token,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ organizationId: data });
}
