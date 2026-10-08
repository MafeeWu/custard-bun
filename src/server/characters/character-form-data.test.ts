import { describe, expect, test } from "vitest";
import { parseCharacterFormData } from "./character-form-data";

function validFormData(overrides: Record<string, string | string[]> = {}) {
  const values: Record<string, string | string[]> = {
    slug: "calm-guide",
    expectedRevision: "7",
    displayName: "Calm Guide",
    avatarPath: "/characters/calm-listener.svg",
    shortDescription: "A steady companion.",
    longDescription: "A patient companion for reflective conversations.",
    personalityPrinciples: "Reflect first.\n\nAsk one grounded question.",
    speakingStyle: "Warm and concise.",
    responseRhythm: "Pause, reflect, then ask.",
    relationshipBoundaries:
      "Do not claim to be human.\nEncourage real support.",
    openingMessage: "What feels most important right now?",
    exampleUser: ["I feel stuck.", "I need a plan."],
    exampleAssistant: [
      "Let's name what feels stuck first.",
      "Let's choose the smallest next step.",
    ],
    temperature: "0.6",
    topP: "0.9",
    maxOutputTokens: "700",
    safetyAdditions: "Suggest emergency help for immediate danger.\n\n",
  };
  const data = new FormData();
  for (const [key, value] of Object.entries({ ...values, ...overrides })) {
    if (Array.isArray(value)) {
      value.forEach((entry) => data.append(key, entry));
    } else {
      data.set(key, value);
    }
  }
  return data;
}

describe("parseCharacterFormData", () => {
  test("converts exact form conventions into character content", () => {
    const result = parseCharacterFormData(validFormData());

    expect(result).toEqual({
      success: true,
      data: {
        slug: "calm-guide",
        expectedRevision: 7,
        content: {
          displayName: "Calm Guide",
          avatarPath: "/characters/calm-listener.svg",
          shortDescription: "A steady companion.",
          longDescription: "A patient companion for reflective conversations.",
          personalityPrinciples: [
            "Reflect first.",
            "Ask one grounded question.",
          ],
          speakingStyle: "Warm and concise.",
          responseRhythm: "Pause, reflect, then ask.",
          relationshipBoundaries: [
            "Do not claim to be human.",
            "Encourage real support.",
          ],
          openingMessage: "What feels most important right now?",
          exampleConversations: [
            {
              user: "I feel stuck.",
              assistant: "Let's name what feels stuck first.",
            },
            {
              user: "I need a plan.",
              assistant: "Let's choose the smallest next step.",
            },
          ],
          generationParameters: {
            temperature: 0.6,
            topP: 0.9,
            maxOutputTokens: 700,
          },
          safetyAdditions: ["Suggest emergency help for immediate danger."],
        },
      },
    });
  });

  test("reports half-filled example pairs as field errors", () => {
    const result = parseCharacterFormData(
      validFormData({
        exampleUser: ["I feel stuck.", "I need a plan."],
        exampleAssistant: ["Let's name what feels stuck first.", ""],
      }),
    );

    expect(result).toEqual({
      success: false,
      fieldErrors: {
        exampleAssistant: ["Example assistant response is required."],
      },
    });
  });

  test("keeps invalid numeric inputs as explicit field errors", () => {
    const result = parseCharacterFormData(
      validFormData({
        temperature: "hot",
        topP: "wide",
        maxOutputTokens: "many",
      }),
    );

    expect(result).toEqual({
      success: false,
      fieldErrors: {
        temperature: ["Temperature must be a valid number."],
        topP: ["Top P must be a valid number."],
        maxOutputTokens: ["Max output tokens must be a valid number."],
      },
    });
  });

  test("maps numeric bounds failures to the exact numeric fields", () => {
    const result = parseCharacterFormData(
      validFormData({
        temperature: "3",
        topP: "2",
        maxOutputTokens: "10",
      }),
    );

    expect(result).toMatchObject({
      success: false,
      fieldErrors: {
        temperature: expect.arrayContaining([expect.any(String)]),
        topP: expect.arrayContaining([expect.any(String)]),
        maxOutputTokens: expect.arrayContaining([expect.any(String)]),
      },
    });
  });

  test("reports invalid submitted slugs as field errors", () => {
    const result = parseCharacterFormData(validFormData({ slug: "Bad Slug!" }));

    expect(result).toEqual({
      success: false,
      fieldErrors: {
        slug: ["Slug must use lowercase letters, numbers, and hyphens."],
      },
    });
  });
});
