import { describe, it, expect } from "vitest";
import { generateApiKey, hashApiKey, parseBearerToken } from "../mcp-auth";

describe("generateApiKey", () => {
  it("returns a string starting with wmk_", () => {
    const key = generateApiKey();
    expect(key).toMatch(/^wmk_[A-Za-z0-9_-]+$/);
  });

  it("returns 32+ chars after the prefix", () => {
    const key = generateApiKey();
    expect(key.length).toBeGreaterThanOrEqual(36);
  });

  it("returns a different key each call", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a).not.toBe(b);
  });
});

describe("hashApiKey", () => {
  it("returns 64 hex chars (SHA-256)", () => {
    const h = hashApiKey("wmk_abc");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic", () => {
    expect(hashApiKey("wmk_abc")).toBe(hashApiKey("wmk_abc"));
  });

  it("differs across keys", () => {
    expect(hashApiKey("wmk_a")).not.toBe(hashApiKey("wmk_b"));
  });
});

describe("parseBearerToken", () => {
  it("returns the token from a Bearer header", () => {
    expect(parseBearerToken("Bearer wmk_abc")).toBe("wmk_abc");
  });

  it("returns null for non-Bearer schemes", () => {
    expect(parseBearerToken("Basic xyz")).toBeNull();
  });

  it("returns null for missing header", () => {
    expect(parseBearerToken(null)).toBeNull();
    expect(parseBearerToken(undefined)).toBeNull();
    expect(parseBearerToken("")).toBeNull();
  });

  it("returns null for malformed Bearer", () => {
    expect(parseBearerToken("Bearer")).toBeNull();
    expect(parseBearerToken("Bearer ")).toBeNull();
  });
});
