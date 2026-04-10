import { Command } from "commander";
import { ingestCommand } from "./ingest.js";
import { reportCommand } from "./report.js";
import { exportCommand } from "./export.js";

const program = new Command();

program
  .name("workflow-miner")
  .description(
    "Watch work behavior across Gmail, Slack, Linear, and Calendar, detect recurring workflow patterns, and export them as Claude skill packs.",
  )
  .version("0.1.0");

program.addCommand(ingestCommand);
program.addCommand(reportCommand);
program.addCommand(exportCommand);

program.parse();
