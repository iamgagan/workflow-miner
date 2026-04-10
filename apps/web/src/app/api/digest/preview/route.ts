import { render } from "@react-email/components";
import { WeeklyDigest } from "@/emails/weekly-digest";
import { MOCK_DIGEST_DATA } from "@/emails/mock-digest-data";

export async function GET() {
  const html = await render(WeeklyDigest(MOCK_DIGEST_DATA));

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
