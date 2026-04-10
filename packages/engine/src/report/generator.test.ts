import { describe, it, expect } from "vitest";
import { generateMarkdownReport, generateHtmlReport } from "./generator.js";
import type { ScoredPattern } from "../mining/scorer.js";

function scoredPattern(overrides: Partial<ScoredPattern> = {}): ScoredPattern {
  return {
    patternId: "p-1",
    name: "Bug Triage Flow",
    compositeScore: 78,
    breakdown: {
      frequency: 90,
      consistency: 80,
      completionRate: 70,
      automationPotential: 60,
    },
    ...overrides,
  };
}

describe("report/generator", () => {
  describe("generateMarkdownReport", () => {
    it("includes header and pattern count", () => {
      const md = generateMarkdownReport([scoredPattern()]);

      expect(md).toContain("# Workflow Pattern Report");
      expect(md).toContain("Total patterns: 1");
    });

    it("includes pattern name and score", () => {
      const md = generateMarkdownReport([scoredPattern()]);

      expect(md).toContain("### Bug Triage Flow");
      expect(md).toContain("**Score:** 78/100");
    });

    it("includes automation potential label", () => {
      const md = generateMarkdownReport([
        scoredPattern({ breakdown: { frequency: 0, consistency: 0, completionRate: 0, automationPotential: 85 } }),
      ]);

      expect(md).toContain("**Automation Potential:** High");
    });

    it("shows Medium automation for score 50-79", () => {
      const md = generateMarkdownReport([
        scoredPattern({ breakdown: { frequency: 0, consistency: 0, completionRate: 0, automationPotential: 60 } }),
      ]);

      expect(md).toContain("**Automation Potential:** Medium");
    });

    it("shows Low automation for score 20-49", () => {
      const md = generateMarkdownReport([
        scoredPattern({ breakdown: { frequency: 0, consistency: 0, completionRate: 0, automationPotential: 30 } }),
      ]);

      expect(md).toContain("**Automation Potential:** Low");
    });

    it("shows Minimal automation for score below 20", () => {
      const md = generateMarkdownReport([
        scoredPattern({ breakdown: { frequency: 0, consistency: 0, completionRate: 0, automationPotential: 10 } }),
      ]);

      expect(md).toContain("**Automation Potential:** Minimal");
    });

    it("includes breakdown scores", () => {
      const md = generateMarkdownReport([scoredPattern()]);

      expect(md).toContain("Frequency: 90");
      expect(md).toContain("Consistency: 80");
      expect(md).toContain("Completion: 70");
      expect(md).toContain("Automation: 60");
    });

    it("handles empty patterns array", () => {
      const md = generateMarkdownReport([]);

      expect(md).toContain("Total patterns: 0");
      expect(md).toContain("No patterns discovered yet.");
    });

    it("renders multiple patterns", () => {
      const patterns = [
        scoredPattern({ patternId: "a", name: "Flow A" }),
        scoredPattern({ patternId: "b", name: "Flow B" }),
      ];
      const md = generateMarkdownReport(patterns);

      expect(md).toContain("### Flow A");
      expect(md).toContain("### Flow B");
      expect(md).toContain("Total patterns: 2");
    });
  });

  describe("generateHtmlReport", () => {
    it("produces valid HTML with table", () => {
      const html = generateHtmlReport([scoredPattern()]);

      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("<table>");
      expect(html).toContain("Bug Triage Flow");
      expect(html).toContain("78");
    });

    it("escapes HTML in pattern names", () => {
      const html = generateHtmlReport([
        scoredPattern({ name: "<script>alert(1)</script>" }),
      ]);

      expect(html).not.toContain("<script>alert(1)</script>");
      expect(html).toContain("&lt;script&gt;");
    });

    it("shows empty message when no patterns", () => {
      const html = generateHtmlReport([]);

      expect(html).toContain("No patterns discovered yet.");
      expect(html).not.toContain("<table>");
    });

    it("includes automation label in table", () => {
      const html = generateHtmlReport([scoredPattern()]);

      expect(html).toContain("Medium");
    });

    it("shows pattern count", () => {
      const html = generateHtmlReport([scoredPattern(), scoredPattern({ patternId: "x" })]);

      expect(html).toContain("2 pattern(s)");
    });

    it("escapes single quotes in pattern names", () => {
      const html = generateHtmlReport([
        scoredPattern({ name: "it's a test" }),
      ]);

      expect(html).not.toContain("it's a test");
      expect(html).toContain("it&#39;s a test");
    });
  });
});
