import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted mocks for the lazy clients used inside functions.ts.
const supabaseMock = vi.hoisted(() => ({
  from: vi.fn(),
}));
const openaiMock = vi.hoisted(() => ({
  chat: { completions: { create: vi.fn() } },
  embeddings: { create: vi.fn() },
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => supabaseMock,
}));
vi.mock("openai", () => ({
  default: vi.fn(() => openaiMock),
}));

describe("Dream Cycle compiled_truth refresh", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("keeps existing compiled_truth when no new timeline entries exist", async () => {
    supabaseMock.from.mockReturnValue({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      }),
    });

    const { refreshCompiledTruth } = await import("../functions");
    const result = await refreshCompiledTruth({
      id: 1,
      slug: "x",
      title: "X",
      compiled_truth: "Existing summary.",
      timeline: null,
    });

    expect(result).toBe("Existing summary.");
    expect(openaiMock.chat.completions.create).not.toHaveBeenCalled();
  });
});

describe("Dream Cycle entity extraction", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("parses a JSON-array response", async () => {
    openaiMock.chat.completions.create.mockResolvedValue({
      choices: [{ message: { content: '[{"type":"person","name":"Garry Tan","slug":"garry-tan"}]' } }],
    });

    const { extractEntities } = await import("../functions");
    const result = await extractEntities("Garry Tan announced new YC batch.");

    expect(result).toEqual([{ type: "person", name: "Garry Tan", slug: "garry-tan" }]);
  });

  it("parses a {entities: [...]} response", async () => {
    openaiMock.chat.completions.create.mockResolvedValue({
      choices: [{ message: { content: '{"entities":[{"type":"company","name":"Acme","slug":"acme"}]}' } }],
    });

    const { extractEntities } = await import("../functions");
    const result = await extractEntities("Acme launched their product.");

    expect(result).toEqual([{ type: "company", name: "Acme", slug: "acme" }]);
  });

  it("filters out malformed entries", async () => {
    openaiMock.chat.completions.create.mockResolvedValue({
      choices: [{ message: { content: '[{"type":"animal","name":"Fox","slug":"fox"},{"type":"person","name":"Eve","slug":"eve"}]' } }],
    });

    const { extractEntities } = await import("../functions");
    const result = await extractEntities("Eve and a fox in the garden today.");

    expect(result).toEqual([{ type: "person", name: "Eve", slug: "eve" }]);
  });

  it("returns empty array on LLM error", async () => {
    openaiMock.chat.completions.create.mockRejectedValue(new Error("rate limit"));

    const { extractEntities } = await import("../functions");
    const result = await extractEntities("anything that is more than twenty chars");

    expect(result).toEqual([]);
  });
});
