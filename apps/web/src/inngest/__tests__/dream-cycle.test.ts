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
    vi.clearAllMocks();
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
