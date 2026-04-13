import { Command } from "commander";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { SkillCompiler } from "../compiler/skill-compiler.js";
import { SkillValidator } from "../compiler/validator.js";
import { DatabaseClient } from "../db/client.js";
import { PatternRepository } from "../db/repositories/pattern-repository.js";
import type { EventType } from "../normalize/schema.js";
import type { PatternCandidate, ScoredPattern } from "../mining/scorer.js";

export const exportCommand = new Command("export")
  .description("Export a detected workflow as a Claude skill pack")
  .argument("<pattern-id>", "ID of the workflow pattern to export")
  .option("-o, --output-dir <dir>", "Output directory for the skill pack", "./skills")
  .option("--db <path>", "Path to the SQLite database")
  .action(async (patternId: string, opts: { outputDir: string; db?: string }) => {
    let dbClient: DatabaseClient | null = null;
    try {
      dbClient = new DatabaseClient(opts.db ? { dbPath: opts.db } : {});
      const repo = new PatternRepository(dbClient.raw);

      const row = repo.findById(patternId);
      if (!row) {
        console.error(
          `Pattern "${patternId}" not found.\n` +
          `Run 'workflow-miner ingest' and 'workflow-miner mine' first.`,
        );
        process.exitCode = 1;
        return;
      }

      const eventRows = repo.findEvents(patternId);
      const metadata = JSON.parse(row.metadata || "{}") as Record<string, unknown>;
      const sources = JSON.parse(row.source_systems || "[]") as string[];

      // Build the ScoredPattern from the DB row
      const scored: ScoredPattern = {
        patternId: row.pattern_id,
        name: row.name,
        compositeScore: row.confidence,
        breakdown: {
          frequency: (metadata.frequency as number) ?? row.frequency / 100,
          consistency: (metadata.consistency as number) ?? row.confidence,
          completionRate: (metadata.completionRate as number) ?? 1.0,
          automationPotential: (metadata.automationPotential as number) ?? 0.5,
        },
      };

      // Build the PatternCandidate from the event rows
      const steps = eventRows.map((e) => e.event_type as EventType);
      const candidate: PatternCandidate = {
        id: row.pattern_id,
        name: row.name,
        steps,
        instances: [
          {
            eventTypes: steps,
            completed: true,
          },
        ],
      };

      const skillDir = compileAndWrite(scored, candidate, opts.outputDir);
      console.log(`Skill pack written to: ${skillDir}`);
    } finally {
      dbClient?.close();
    }
  });

/**
 * Compile a pattern into a validated skill pack (without writing to disk).
 */
export function compile(
  scored: ScoredPattern,
  candidate: PatternCandidate,
) {
  const compiler = new SkillCompiler();
  const validator = new SkillValidator();

  const pack = compiler.compile({ scored, candidate });

  const result = validator.validate(pack);
  if (!result.valid) {
    throw new Error(
      `Skill validation failed:\n${result.errors.map((e) => `  - ${e}`).join("\n")}`,
    );
  }

  return { pack, compiler };
}

/**
 * Compile a pattern and write the skill pack to disk.
 * Exported for use by tests and future DB-wired integration.
 */
export function compileAndWrite(
  scored: ScoredPattern,
  candidate: PatternCandidate,
  outputDir: string,
): string {
  const { pack, compiler } = compile(scored, candidate);

  const resolvedOutput = resolve(outputDir);
  const skillDir = join(resolvedOutput, pack.id);
  if (!skillDir.startsWith(resolvedOutput + "/") && skillDir !== resolvedOutput) {
    throw new Error("Skill output path escapes the output directory");
  }
  mkdirSync(skillDir, { recursive: true });

  writeFileSync(join(skillDir, "metadata.yaml"), compiler.metadataToYaml(pack.metadata));
  writeFileSync(join(skillDir, "SKILL.md"), pack.skillMd);
  writeFileSync(join(skillDir, "test-cases.yaml"), compiler.testCasesToYaml(pack.testCases));

  return skillDir;
}
