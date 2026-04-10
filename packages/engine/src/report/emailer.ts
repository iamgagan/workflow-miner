import { createTransport } from "nodemailer";
import type { EmailConfig } from "../config/schema.js";

export interface SendReportOptions {
  readonly config: EmailConfig;
  readonly subject: string;
  readonly html: string;
}

export async function sendReportEmail(options: SendReportOptions): Promise<void> {
  const { config, subject, html } = options;

  const transport = createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure ?? config.port === 465,
    auth: {
      user: config.user,
      pass: config.pass,
    },
  });

  await transport.sendMail({
    from: config.fromEmail,
    to: config.toEmail,
    subject,
    html,
  });
}
