import { Command } from "commander";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { SkillCompiler } from "../compiler/skill-compiler.js";
import { SkillValidator } from "../compiler/validator.js";
import type { PatternCandidate, ScoredPattern } from "../mining/scorer.js";

export const exportCommand = new Command("export")
  .description("Export a detected workflow as a Claude skill pack")
  .argument("<pattern-id>", "ID of the workflow pattern to export")
  .option("-o, --output-dir <dir>", "Output directory for the skill pack", "./skills")
  .action((patternId: string, opts: { outputDir: string }) => {
    // TODO: Load pattern from database by ID once DB layer is wired up.
    // For now, print usage and exit.
    console.error(
      `Looking up pattern "${patternId}" in the database...\n` +
      `(Pattern lookup requires a prior 'workflow-miner ingest' run.)\n` +
      `Once found, the skill will be written to: ${opts.outputDir}/${patternId}/`,
    );

    // Placeholder: when the DB lookup is implemented, call compileAndWrite().
    process.exitCode = 1;
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
