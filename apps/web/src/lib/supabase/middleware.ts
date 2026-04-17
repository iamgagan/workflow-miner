import { NextResponse, type NextRequest } from "next/server";

// Desktop-only: no session to refresh and no /login to redirect to. Kept as a
// trivial passthrough in case anything still imports `updateSession` from
// this module — the root middleware no longer does.
export async function updateSession(request: NextRequest) {
  return NextResponse.next({ request });
}
