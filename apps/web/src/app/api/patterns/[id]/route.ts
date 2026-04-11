import { NextResponse } from "next/server";
import { getPattern } from "@/lib/gbrain";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const pattern = await getPattern(id);

  if (!pattern) {
    return NextResponse.json({ error: "Pattern not found" }, { status: 404 });
  }

  return NextResponse.json(pattern);
}
