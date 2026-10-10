import { describe, expect, test } from "vitest";
import type { MemoryCandidate } from "./memory-contracts";
import {
  memoryDigest,
  normalizeMemoryCandidate,
  normalizeMemoryText,
} from "./memory-normalization";

function createCandidate(
  overrides: Partial<MemoryCandidate> = {},
): MemoryCandidate {
  return {
    type: "preferred_name",
    content: "Ａｌｉｃｅ\t  Example ",
    sourceMessageId: "f77e13b0-8e37-4ab7-b39e-0d957fe5f97e",
    explicitness: "direct",
    sensitivity: "ordinary",
    userExplicitlyAskedToRemember: false,
    confidence: 100,
    importance: 80,
    ...overrides,
  };
}

describe("normalizeMemoryText", () => {
  test("normalizes unicode, collapses whitespace, and trims", () => {
    expect(normalizeMemoryText(" Ａｌｉｃｅ\t\n  Example  ")).toBe(
      "Alice Example",
    );
  });
});

describe("normalizeMemoryCandidate", () => {
  test("preserves normalized casing while deriving a lowercase digest input", () => {
    const normalized = normalizeMemoryCandidate(createCandidate());

    expect(normalized).toMatchObject({
      type: "preferred_name",
      content: "Alice Example",
      normalizedContent: "Alice Example",
    });
    expect(normalized.normalizedDigest).toBe(
      memoryDigest({
        type: "preferred_name",
        normalizedContent: "Alice Example",
      }),
    );
    expect(
      memoryDigest({
        type: "preferred_name",
        normalizedContent: "ALICE EXAMPLE",
      }),
    ).toBe(normalized.normalizedDigest);
  });

  test("rejects normalized content that expands beyond the 500-character item limit", () => {
    const candidate = createCandidate({
      content: "ﬀ".repeat(500),
    });

    expect(() => normalizeMemoryCandidate(candidate)).toThrow(
      /500|max item|normalized/i,
    );

    try {
      normalizeMemoryCandidate(candidate);
      throw new Error("Expected normalizeMemoryCandidate to throw.");
    } catch (error) {
      expect(error).toMatchObject({ code: "CHAT_VALIDATION" });
    }
  });
});
