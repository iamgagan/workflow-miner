import { Command } from "commander";
import { loadConfig } from "../config/loader.js";
import { getDefaultClient } from "../db/client.js";
import { EventRepository } from "../db/repositories/event-repository.js";
import { runIngest } from "../pipeline/ingest.js";

const VALID_SOURCES = ["gmail", "slack", "linear", "calendar", "all"] as const;

export const ingestCommand = new Command("ingest")
  .description("Ingest events from connected work tools")
  .option(
    "-s, --source <source>",
    `Source to ingest from (${VALID_SOURCES.join(", ")})`,
    "all",
  )
  .option(
    "-d, --days <days>",
    "Number of days to look back",
    "30",
  )
  .option(
    "--dry-run",
    "Show what would be ingested without writing to DB",
    false,
  )
  .action(async (options: { source: string; days: string; dryRun: boolean }) => {
    const source = options.source;
    if (!VALID_SOURCES.includes(source as (typeof VALID_SOURCES)[number])) {
      console.error(
        `Invalid source: ${source}. Valid sources: ${VALID_SOURCES.join(", ")}`,
      );
      process.exit(1);
    }

    const days = parseInt(options.days, 10);
    if (isNaN(days) || days < 1) {
      console.error("--days must be a positive integer");
      process.exit(1);
    }

    try {
      const config = loadConfig();
      const dbClient = getDefaultClient();
      const repo = new EventRepository(dbClient.raw);

      const result = await runIngest(
        { source, days, dryRun: options.dryRun },
        {
          config,
          insertMany: (events) => repo.insertMany(events),
        },
      );

      console.log(
        `\nSummary: ${result.totalEvents} events ingested from ${Object.keys(result.sourceCounts).length} sources, ${result.errors.length} errors`,
      );

      if (!options.dryRun) {
        dbClient.close();
      }
    } catch (err) {
      console.error("Ingest failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });
