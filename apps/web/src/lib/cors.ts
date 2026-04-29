import { NextResponse } from "next/server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

// Wraps a NextResponse with the CORS headers needed for cross-origin MCP +
// API key clients. Bearer-token auth (api_keys) makes "*" origin safe —
// no cookie surface.
export function withCors(response: NextResponse): NextResponse {
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    response.headers.set(k, v);
  }
  return response;
}

// Use as the OPTIONS handler in MCP route files for CORS preflight.
export function corsPreflight(): NextResponse {
  return withCors(new NextResponse(null, { status: 204 }));
}
