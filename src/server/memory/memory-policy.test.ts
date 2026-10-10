import { describe, expect, test } from "vitest";
import type { MemoryCandidate } from "./memory-contracts";
import { normalizeMemoryCandidate } from "./memory-normalization";
import { assertMemoryCandidateAllowed } from "./memory-policy";

function createCandidate(
  overrides: Partial<MemoryCandidate> = {},
): MemoryCandidate {
  return {
    type: "preference",
    content: "Please remember that I love ginger tea.",
    sourceMessageId: "1dd97fec-e093-4b10-99ca-c4b7bb9490f6",
    explicitness: "direct",
    sensitivity: "ordinary",
    userExplicitlyAskedToRemember: false,
    confidence: 90,
    importance: 60,
    ...overrides,
  };
}

describe("assertMemoryCandidateAllowed", () => {
  test("allows ordinary direct memory candidates", () => {
    expect(() =>
      assertMemoryCandidateAllowed(normalizeMemoryCandidate(createCandidate())),
    ).not.toThrow();
  });

  test.each([
    ["passwords", "please remember my password is hunter2"],
    ["passcodes", "remember my bank passcode is 123456"],
    ["otp codes", "remember my otp is 654321"],
    ["one-time codes", "remember my one-time code is 654321"],
    ["recovery codes", "remember my recovery code is AX91-BQ22"],
    ["api keys", "remember my API key is live_abcdef123456"],
    ["api tokens", "remember my API token is live_abcdef123456"],
    ["hyphenated api tokens", "remember my api-token is live_abcdef123456"],
    ["underscored api tokens", "remember my api_token is live_abcdef123456"],
    ["auth tokens", "remember my auth token is live_abcdef123456"],
    [
      "authentication tokens",
      "remember my authentication token is live_abcdef123456",
    ],
    ["bearer tokens", "remember my bearer token is live_abcdef123456"],
    ["private keys", "remember my private key begins with -----BEGIN PRIVATE KEY-----"],
    ["card numbers", "remember my card number is 4111111111111111"],
    ["debit card PINs", "remember my debit card PIN is 1234"],
    ["credit card PINs", "remember my credit card pin is 1234"],
    [
      "credit card security answers",
      "remember my credit card security answer is blue",
    ],
  ])("rejects %s", (_title, content) => {
    const candidate = normalizeMemoryCandidate(createCandidate({ content }));

    expect(() => assertMemoryCandidateAllowed(candidate)).toThrow(
      /credential|secret|sensitive|card|bank/i,
    );

    try {
      assertMemoryCandidateAllowed(candidate);
      throw new Error("Expected assertMemoryCandidateAllowed to throw.");
    } catch (error) {
      expect(error).toMatchObject({ code: "CHAT_VALIDATION" });
    }
  });

  test("allows personal-sensitive memory only when the user explicitly asked to remember it", () => {
    expect(() =>
      assertMemoryCandidateAllowed(
        normalizeMemoryCandidate(
          createCandidate({
            type: "personal_fact",
            content: "Please remember that my precise address is 10 Main Street.",
            sensitivity: "personal_explicit",
            userExplicitlyAskedToRemember: true,
          }),
        ),
      ),
    ).not.toThrow();
  });

  test("rejects personal-sensitive memory when the user did not explicitly ask to remember it", () => {
    const candidate = normalizeMemoryCandidate(
      createCandidate({
        type: "personal_fact",
        content: "My precise address is 10 Main Street.",
        sensitivity: "personal_explicit",
      }),
    );

    expect(() => assertMemoryCandidateAllowed(candidate)).toThrow(
      /explicitly asked|personal/i,
    );
  });

  test("rejects repeated inference for personal-sensitive memory", () => {
    const candidate = normalizeMemoryCandidate(
      createCandidate({
        type: "personal_fact",
        content: "Please remember that my health condition is private.",
        sensitivity: "personal_explicit",
        explicitness: "repeated_inference",
        userExplicitlyAskedToRemember: true,
      }),
    );

    expect(() => assertMemoryCandidateAllowed(candidate)).toThrow(
      /repeated|inference|personal/i,
    );
  });
});
