import { NextRequest, NextResponse } from "next/server";
import { createTransport } from "nodemailer";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

interface FeedbackRequest {
  message: string;
  context?: string; // e.g. "dashboard", "patterns/[id]"
}

async function sendFeedbackEmail(
  from: string,
  userEmail: string,
  message: string,
  context: string,
): Promise<boolean> {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const to = process.env.FEEDBACK_TO_EMAIL;

  if (!host || !user || !pass || !to) return false;

  const port = parseInt(process.env.SMTP_PORT ?? "587", 10);
  const transport = createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  await transport.sendMail({
    from,
    to,
    replyTo: userEmail,
    subject: `[Workflow Miner feedback] ${context}`,
    text: `From: ${userEmail}\nContext: ${context}\n\n${message}`,
  });
  return true;
}

export async function POST(request: NextRequest) {
  let body: FeedbackRequest;
  try {
    body = (await request.json()) as FeedbackRequest;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.message || typeof body.message !== "string" || body.message.trim().length < 3) {
    return NextResponse.json({ error: "message_too_short" }, { status: 400 });
  }

  // Resolve the user's email (best-effort — feedback still works without auth)
  let userEmail = "anonymous";
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    if (data?.user?.email) userEmail = data.user.email;
  } catch {
    // ignore — fall through with "anonymous"
  }

  const from = process.env.REPORT_FROM_EMAIL ?? "no-reply@localhost";
  const context = body.context ?? "unknown";
  const message = body.message.slice(0, 5000);

  // Always log feedback to stdout so it's visible in server logs even when
  // SMTP isn't configured — handy for early alpha.
  console.log(
    `[feedback] from=${userEmail} context=${context}\n${message}`,
  );

  let emailed = false;
  try {
    emailed = await sendFeedbackEmail(from, userEmail, message, context);
  } catch (err) {
    console.error("[feedback] failed to send email:", err);
  }

  return NextResponse.json({ ok: true, emailed });
}
