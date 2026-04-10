import { NextResponse } from "next/server";
import { render } from "@react-email/components";
import { WeeklyDigest } from "@/emails/weekly-digest";
import { MOCK_DIGEST_DATA } from "@/emails/mock-digest-data";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { to } = body as { to?: string };

  if (!to) {
    return NextResponse.json(
      { error: "Missing required field: to" },
      { status: 400 },
    );
  }

  const html = await render(WeeklyDigest(MOCK_DIGEST_DATA));

  // In production, send via Resend or nodemailer.
  // For now, return the rendered HTML as confirmation.
  return NextResponse.json({
    ok: true,
    to,
    subject: `Your Week in Patterns \u2014 ${MOCK_DIGEST_DATA.weekStart} to ${MOCK_DIGEST_DATA.weekEnd}`,
    htmlLength: html.length,
  });
}
