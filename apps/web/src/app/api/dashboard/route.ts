import { NextResponse } from "next/server";
import { getGBrainStats } from "@/lib/gbrain";

export async function GET() {
  const stats = await getGBrainStats();
  return NextResponse.json(stats);
}
