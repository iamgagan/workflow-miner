export interface BrainPageRow {
  id: number;
  slug: string;
  type: string;
  title: string;
  compiled_truth: string | null;
  timeline: string | null;
  frontmatter: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface BrainLinkRow {
  from_slug: string;
  to_slug: string;
  link_type: string;
}

const KNOWN_TYPES = new Set(["concept", "person", "company", "project", "pattern"]);

function escapeYamlScalar(value: string): string {
  if (/[":#\n&*!|>'%@`]/.test(value)) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return value;
}

function renderTags(tags: unknown): string | null {
  if (!Array.isArray(tags) || tags.length === 0) return null;
  const safe = tags
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.replace(/[\[\],"]/g, ""));
  return safe.length > 0 ? `[${safe.join(", ")}]` : null;
}

export function renderPageToMarkdown(page: BrainPageRow, links: BrainLinkRow[]): string {
  const outgoingLinks = links.filter((l) => l.from_slug === page.slug);
  const tags = renderTags(page.frontmatter?.tags);

  const fmLines = [
    "---",
    `title: ${escapeYamlScalar(page.title)}`,
    `type: ${page.type}`,
    `slug: ${page.slug}`,
    `created: ${page.created_at}`,
    `updated: ${page.updated_at}`,
  ];

  if (outgoingLinks.length > 0) {
    fmLines.push("links:");
    for (const link of outgoingLinks) {
      fmLines.push(`  - to: ${link.to_slug}`);
      fmLines.push(`    type: ${link.link_type}`);
    }
  }

  if (tags) {
    fmLines.push(`tags: ${tags}`);
  }

  fmLines.push("---", "");

  const body = [
    "## Compiled truth",
    "",
    page.compiled_truth?.trim() || "_(empty)_",
    "",
  ];

  if (page.timeline?.trim()) {
    body.push("## Timeline", "", page.timeline.trim(), "");
  }

  return [...fmLines, ...body].join("\n");
}

export function slugToFilePath(type: string, slug: string): string {
  const safeType = KNOWN_TYPES.has(type) ? type : "concept";
  return `pages/${safeType}/${slug}.md`;
}
