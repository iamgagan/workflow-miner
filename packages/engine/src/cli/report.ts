import { Command } from "commander";
import { loadConfig } from "../config/index.js";
import { generateMarkdownReport, generateHtmlReport, sendReportEmail } from "../report/index.js";
import { runReportPipeline } from "../pipeline/report.js";
import { getDefaultClient } from "../db/client.js";

export const reportCommand = new Command("report")
  .description("Generate a workflow pattern report")
  .option("--send", "Send the report via email")
  .option("--since <date>", "Only include events after this ISO date")
  .option("--min-score <n>", "Minimum composite score to include (default: 0)", parseInt)
  .option("--top <n>", "Maximum number of patterns (default: 20)", parseInt)
  .action(async (options: { send?: boolean; since?: string; minScore?: number; top?: number }) => {
    let db;
    try {
      db = getDefaultClient().raw;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Error: failed to connect to database: ${message}`);
      process.exit(1);
    }

    const result = runReportPipeline(db, {
      since: options.since,
      minScore: options.minScore,
      top: options.top,
    });

    const { patterns } = result;

    if (options.send) {
      const config = loadConfig();
      if (!config.email) {
        console.error("Error: email configuration not found. Set SMTP_HOST, SMTP_USER, SMTP_PASS, REPORT_TO_EMAIL, and REPORT_FROM_EMAIL.");
        process.exit(1);
      }

      const html = generateHtmlReport(patterns);
      const subject = `Workflow Pattern Report — ${new Date().toLocaleDateString()}`;

      try {
        await sendReportEmail({ config: config.email, subject, html });
        console.log(`Report sent to ${config.email.toEmail}`);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: failed to send report email: ${message}`);
        process.exit(1);
      }
    } else {
      const markdown = generateMarkdownReport(patterns);
      console.log(markdown);
    }
  });
