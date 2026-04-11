import { NextResponse } from "next/server";
import { getPatternEvidence } from "@/lib/gbrain";
import { getPatternById } from "@/lib/mock-patterns";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const evidence = await getPatternEvidence(id);

  if (evidence.length > 0) {
    return NextResponse.json(evidence);
  }

  // Fall back to mock data if gbrain has no evidence
  const mock = getPatternById(id);
  if (!mock) {
    return NextResponse.json({ error: "Pattern not found" }, { status: 404 });
  }
  return NextResponse.json(mock.evidence);
}
