import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchWithRetry } from "./http-utils.js";

describe("http-utils/fetchWithRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns response on success", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response("ok", { status: 200 }),
    );

    const resp = await fetchWithRetry("https://example.com", {}, { fetchFn: mockFetch });
    expect(resp.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("retries on 429 status", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const resp = await fetchWithRetry("https://example.com", {}, {
      fetchFn: mockFetch,
      maxRetries: 3,
    });
    expect(resp.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("retries on 500 status", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("error", { status: 500 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const resp = await fetchWithRetry("https://example.com", {}, {
      fetchFn: mockFetch,
      maxRetries: 3,
    });
    expect(resp.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry on 400 status", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response("bad request", { status: 400 }),
    );

    const resp = await fetchWithRetry("https://example.com", {}, {
      fetchFn: mockFetch,
      maxRetries: 3,
    });
    expect(resp.status).toBe(400);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("returns last error response after exhausting retries", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response("error", { status: 503 }),
    );

    const resp = await fetchWithRetry("https://example.com", {}, {
      fetchFn: mockFetch,
      maxRetries: 2,
    });
    expect(resp.status).toBe(503);
    expect(mockFetch).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("retries on network error and eventually throws", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("network failure"));

    await expect(
      fetchWithRetry("https://example.com", {}, {
        fetchFn: mockFetch,
        maxRetries: 1,
      }),
    ).rejects.toThrow("network failure");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
