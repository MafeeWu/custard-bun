import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
  parseMemoryCandidates,
  type MemoryCandidate,
} from "./memory-contracts";

function createCandidate(
  overrides: Partial<MemoryCandidate> = {},
): MemoryCandidate {
  return {
    type: "preferred_name",
    content: "Please remember I go by Mx. Rivera.",
    sourceMessageId: randomUUID(),
    explicitness: "direct",
    sensitivity: "ordinary",
    userExplicitlyAskedToRemember: false,
    confidence: 100,
    importance: 80,
    ...overrides,
  };
}

describe("parseMemoryCandidates", () => {
  test("parses strict provider candidates without provider-controlled normalization", () => {
    const candidate = createCandidate();

    expect(parseMemoryCandidates([candidate])).toEqual([candidate]);
  });

  test("preserves raw provider content for later local normalization", () => {
    const candidate = createCandidate({
      content: "  Please remember I prefer Oolong tea.  ",
    });

    expect(parseMemoryCandidates([candidate])[0]?.content).toBe(candidate.content);
  });

  test.each([
    [
      "unknown keys",
      [{ ...createCandidate(), unexpected: true }],
      /unknown|unexpected/i,
    ],
    [
      "provider normalization fields",
      [{ ...createCandidate(), normalizedContent: "provider-controlled" }],
      /normalizedContent|unknown/i,
    ],
    [
      "invalid UUIDs",
      [createCandidate({ sourceMessageId: "not-a-uuid" })],
      /sourceMessageId|uuid/i,
    ],
    [
      "unknown types",
      [{ ...createCandidate(), type: "secret" }],
      /type|invalid/i,
    ],
    [
      "unknown explicitness values",
      [{ ...createCandidate(), explicitness: "implied" }],
      /explicitness|invalid/i,
    ],
    [
      "unknown sensitivity values",
      [{ ...createCandidate(), sensitivity: "sensitive" }],
      /sensitivity|invalid/i,
    ],
    [
      "content longer than 500 characters",
      [createCandidate({ content: "x".repeat(501) })],
      /content|500/i,
    ],
    [
      "confidence below range",
      [createCandidate({ confidence: -1 })],
      /confidence|0/i,
    ],
    [
      "importance above range",
      [createCandidate({ importance: 101 })],
      /importance|100/i,
    ],
    [
      "more than 20 candidates",
      Array.from({ length: 21 }, () => createCandidate()),
      /20|too_big|too many/i,
    ],
  ])("rejects %s", (_title, value, expectedMessage) => {
    expect(() => parseMemoryCandidates(value)).toThrow(expectedMessage);

    try {
      parseMemoryCandidates(value);
      throw new Error("Expected parseMemoryCandidates to throw.");
    } catch (error) {
      expect(error).toMatchObject({ code: "CHAT_VALIDATION" });
    }
  });
});
