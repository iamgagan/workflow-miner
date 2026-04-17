import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Desktop-only: no hosted auth, no redirects. Kept as a passthrough so the
// matcher continues to exclude static assets and any future desktop-mode
// request shaping has an obvious home.
export function middleware(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|manifest\\.json|sw\\.js)$).*)",
  ],
};
