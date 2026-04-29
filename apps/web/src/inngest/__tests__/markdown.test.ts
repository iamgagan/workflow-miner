import { describe, it, expect } from "vitest";
import { renderPageToMarkdown, slugToFilePath } from "../markdown";

describe("renderPageToMarkdown", () => {
  it("emits frontmatter + compiled truth + timeline section", () => {
    const md = renderPageToMarkdown({
      id: 1,
      slug: "acme-q3-roadmap",
      type: "concept",
      title: "ACME Q3 Roadmap",
      compiled_truth: "The team agreed to migrate to Supabase.",
      timeline: null,
      frontmatter: { tags: ["roadmap", "eng"] },
      created_at: "2026-04-15T00:00:00Z",
      updated_at: "2026-04-29T00:00:00Z",
    }, []);

    expect(md).toContain("---");
    expect(md).toContain("title: ACME Q3 Roadmap");
    expect(md).toContain("type: concept");
    expect(md).toContain("slug: acme-q3-roadmap");
    expect(md).toContain("tags: [roadmap, eng]");
    expect(md).toContain("## Compiled truth");
    expect(md).toContain("The team agreed to migrate to Supabase.");
  });

  it("includes outgoing links in frontmatter", () => {
    const md = renderPageToMarkdown(
      {
        id: 1,
        slug: "acme",
        type: "company",
        title: "ACME",
        compiled_truth: "",
        timeline: null,
        frontmatter: {},
        created_at: "2026-04-15T00:00:00Z",
        updated_at: "2026-04-29T00:00:00Z",
      },
      [
        { from_slug: "acme", to_slug: "garry-tan", link_type: "mentions" },
        { from_slug: "acme", to_slug: "pattern-x", link_type: "derived-from" },
      ]
    );

    expect(md).toContain("links:");
    expect(md).toContain("- to: garry-tan");
    expect(md).toContain("    type: mentions");
    expect(md).toContain("- to: pattern-x");
    expect(md).toContain("    type: derived-from");
  });

  it("omits the links section when no links exist", () => {
    const md = renderPageToMarkdown(
      {
        id: 1,
        slug: "x",
        type: "concept",
        title: "X",
        compiled_truth: "",
        timeline: null,
        frontmatter: {},
        created_at: "2026-04-15T00:00:00Z",
        updated_at: "2026-04-29T00:00:00Z",
      },
      []
    );
    expect(md).not.toContain("links:");
  });

  it("escapes YAML-unsafe characters in title", () => {
    const md = renderPageToMarkdown(
      {
        id: 1,
        slug: "x",
        type: "concept",
        title: 'Has "quotes" and: colons',
        compiled_truth: "",
        timeline: null,
        frontmatter: {},
        created_at: "2026-04-15T00:00:00Z",
        updated_at: "2026-04-29T00:00:00Z",
      },
      []
    );
    expect(md).toContain('title: "Has \\"quotes\\" and: colons"');
  });
});

describe("slugToFilePath", () => {
  it("groups by type", () => {
    expect(slugToFilePath("concept", "acme-roadmap")).toBe("pages/concept/acme-roadmap.md");
    expect(slugToFilePath("person", "garry-tan")).toBe("pages/person/garry-tan.md");
  });

  it("uses concept as the default for unknown types", () => {
    expect(slugToFilePath("unknown", "x")).toBe("pages/concept/x.md");
  });
});
