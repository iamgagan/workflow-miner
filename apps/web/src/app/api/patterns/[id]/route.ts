import { NextResponse } from "next/server";
import { getPattern } from "@/lib/gbrain";
import { getPatternById } from "@/lib/mock-patterns";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const pattern = await getPattern(id);

  if (pattern) {
    return NextResponse.json(pattern);
  }

  // Fall back to mock data if gbrain has no data for this slug
  const mock = getPatternById(id);
  if (!mock) {
    return NextResponse.json({ error: "Pattern not found" }, { status: 404 });
  }
  return NextResponse.json(mock);
}
