import type { ScoredPattern, ScoreBreakdown } from "../mining/scorer.js";

export interface ReportData {
  readonly generatedAt: Date;
  readonly totalPatterns: number;
  readonly patterns: readonly ScoredPattern[];
}

function automationLabel(score: number): string {
  if (score >= 80) return "High";
  if (score >= 50) return "Medium";
  if (score >= 20) return "Low";
  return "Minimal";
}

function breakdownLine(breakdown: ScoreBreakdown): string {
  return (
    `Frequency: ${breakdown.frequency} | ` +
    `Consistency: ${breakdown.consistency} | ` +
    `Completion: ${breakdown.completionRate} | ` +
    `Automation: ${breakdown.automationPotential}`
  );
}

export function generateMarkdownReport(patterns: readonly ScoredPattern[]): string {
  const now = new Date();
  const lines: string[] = [];

  lines.push("# Workflow Pattern Report");
  lines.push("");
  lines.push(`Generated: ${now.toISOString()}`);
  lines.push(`Total patterns: ${patterns.length}`);
  lines.push("");

  if (patterns.length === 0) {
    lines.push("No patterns discovered yet.");
    return lines.join("\n");
  }

  lines.push("## Top Patterns by Score");
  lines.push("");

  for (const pattern of patterns) {
    lines.push(`### ${pattern.name}`);
    lines.push("");
    lines.push(`- **Score:** ${pattern.compositeScore}/100`);
    lines.push(`- **Automation Potential:** ${automationLabel(pattern.breakdown.automationPotential)}`);
    lines.push(`- **Breakdown:** ${breakdownLine(pattern.breakdown)}`);
    lines.push("");
  }

  return lines.join("\n");
}

export function generateHtmlReport(patterns: readonly ScoredPattern[]): string {
  const now = new Date();

  const patternRows = patterns
    .map(
      (p) => `
      <tr>
        <td>${escapeHtml(p.name)}</td>
        <td>${escapeHtml(String(p.compositeScore))}</td>
        <td>${escapeHtml(String(p.breakdown.frequency))}</td>
        <td>${escapeHtml(String(p.breakdown.consistency))}</td>
        <td>${escapeHtml(String(p.breakdown.completionRate))}</td>
        <td>${escapeHtml(automationLabel(p.breakdown.automationPotential))}</td>
      </tr>`,
    )
    .join("\n");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Workflow Pattern Report</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
    h1 { color: #1a1a1a; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #e0e0e0; }
    th { background: #f5f5f5; font-weight: 600; }
    .meta { color: #666; font-size: 14px; }
  </style>
</head>
<body>
  <h1>Workflow Pattern Report</h1>
  <p class="meta">Generated: ${escapeHtml(now.toISOString())} &middot; ${escapeHtml(String(patterns.length))} pattern(s)</p>
  ${
    patterns.length === 0
      ? "<p>No patterns discovered yet.</p>"
      : `<table>
    <thead>
      <tr>
        <th>Workflow</th>
        <th>Score</th>
        <th>Frequency</th>
        <th>Consistency</th>
        <th>Completion</th>
        <th>Automation</th>
      </tr>
    </thead>
    <tbody>${patternRows}
    </tbody>
  </table>`
  }
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
