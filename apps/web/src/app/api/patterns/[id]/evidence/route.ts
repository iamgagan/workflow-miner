import { NextResponse } from "next/server";
import { getPatternEvidence } from "@/lib/gbrain";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const evidence = await getPatternEvidence(id);
  return NextResponse.json(evidence);
}
