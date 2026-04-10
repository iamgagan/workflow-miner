import type { SkillPack, SkillMetadata, SkillTestCase } from "./skill-compiler.js";

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

/**
 * Validates that a generated skill pack has the required structure
 * and all mandatory fields.
 */
export class SkillValidator {
  validate(pack: SkillPack): ValidationResult {
    const errors: string[] = [];

    if (!pack.id || pack.id.trim() === "") {
      errors.push("Skill pack must have a non-empty id");
    }

    errors.push(...this.validateMetadata(pack.metadata));
    errors.push(...this.validateSkillMd(pack.skillMd));
    errors.push(...this.validateTestCases(pack.testCases));

    return { valid: errors.length === 0, errors };
  }

  private validateMetadata(meta: SkillMetadata): readonly string[] {
    const errors: string[] = [];

    if (!meta.name || meta.name.trim() === "") {
      errors.push("metadata.name is required");
    }
    if (!meta.description || meta.description.trim() === "") {
      errors.push("metadata.description is required");
    }
    if (!meta.version || !/^\d+\.\d+\.\d+$/.test(meta.version)) {
      errors.push("metadata.version must be a valid semver (e.g. 1.0.0)");
    }

    // Trigger validation
    if (!meta.trigger) {
      errors.push("metadata.trigger is required");
    } else {
      if (!meta.trigger.description || meta.trigger.description.trim() === "") {
        errors.push("metadata.trigger.description is required");
      }
      if (!meta.trigger.eventTypes || meta.trigger.eventTypes.length === 0) {
        errors.push("metadata.trigger.eventTypes must have at least one entry");
      }
    }

    // Steps validation
    if (!meta.steps || meta.steps.length === 0) {
      errors.push("metadata.steps must have at least one step");
    } else {
      for (let i = 0; i < meta.steps.length; i++) {
        const step = meta.steps[i];
        if (!step.action || step.action.trim() === "") {
          errors.push(`metadata.steps[${i}].action is required`);
        }
        if (!step.eventType || step.eventType.trim() === "") {
          errors.push(`metadata.steps[${i}].eventType is required`);
        }
      }
    }

    // Provenance validation
    if (!meta.provenance) {
      errors.push("metadata.provenance is required");
    } else {
      if (!meta.provenance.patternId) {
        errors.push("metadata.provenance.patternId is required");
      }
      if (!meta.provenance.exportedAt) {
        errors.push("metadata.provenance.exportedAt is required");
      }
    }

    return errors;
  }

  private validateSkillMd(skillMd: string): readonly string[] {
    const errors: string[] = [];

    if (!skillMd || skillMd.trim() === "") {
      errors.push("skillMd content is required");
    } else {
      if (!skillMd.includes("---")) {
        errors.push("skillMd must contain YAML frontmatter");
      }
      if (!skillMd.includes("## Steps")) {
        errors.push("skillMd must contain a Steps section");
      }
      if (!skillMd.includes("## Trigger")) {
        errors.push("skillMd must contain a Trigger section");
      }
    }

    return errors;
  }

  private validateTestCases(testCases: readonly SkillTestCase[]): readonly string[] {
    const errors: string[] = [];

    if (!testCases || testCases.length === 0) {
      errors.push("At least one test case is required");
    } else {
      for (let i = 0; i < testCases.length; i++) {
        const tc = testCases[i];
        if (!tc.name || tc.name.trim() === "") {
          errors.push(`testCases[${i}].name is required`);
        }
        if (!tc.inputEvents || tc.inputEvents.length === 0) {
          errors.push(`testCases[${i}].inputEvents must have at least one event`);
        }
        if (!tc.expectedSteps || tc.expectedSteps.length === 0) {
          errors.push(`testCases[${i}].expectedSteps must have at least one step`);
        }
      }
    }

    return errors;
  }
}
