import { expect, test, describe } from "vitest";
import { characterContentSchema, characterSlugSchema } from "./character-content";

const validContent = {
  displayName: "Mira",
  avatarPath: "/characters/calm-listener.svg",
  shortDescription: "A calm, attentive companion.",
  longDescription: "Mira listens carefully and responds without rushing.",
  personalityPrinciples: ["Listen before advising.", "Name uncertainty."],
  speakingStyle: "Warm, direct, and unhurried.",
  responseRhythm: "Usually two short paragraphs followed by one question.",
  relationshipBoundaries: [
    "Never claim consciousness.",
    "Do not encourage dependency.",
  ],
  openingMessage: "What would feel useful to talk through today?",
  exampleConversations: [
    {
      user: "I had a difficult day.",
      assistant: "I am here. Which part is weighing on you most?",
    },
  ],
  generationParameters: {
    temperature: 0.7,
    topP: 0.9,
    maxOutputTokens: 800,
  },
  safetyAdditions: [
    "Use grounding language when the user sounds overwhelmed.",
  ],
};

describe("character content schema", () => {
  test("parses valid content", () => {
    expect(characterContentSchema.parse(validContent)).toEqual(validContent);
  });

  test("validates character slugs", () => {
    expect(characterSlugSchema.safeParse("Calm Listener").success).toBe(false);
    expect(characterSlugSchema.safeParse("calm-listener").success).toBe(true);
  });

  test.each([
    ["rejects path traversal avatar path", { avatarPath: "/../secret.svg" }],
    [
      "rejects remote avatar path",
      { avatarPath: "https://example.com/avatar.svg" },
    ],
    [
      "rejects query string avatar path",
      { avatarPath: "/characters/avatar.svg?new=1" },
    ],
    [
      "rejects unsupported avatar extension",
      { avatarPath: "/characters/avatar.exe" },
    ],
    ["rejects zero principles", { personalityPrinciples: [] }],
    ["rejects seven example conversations", { exampleConversations: Array.from({ length: 7 }, (_, index) => ({ user: `user ${index}`, assistant: `assistant ${index}` })) }],
    ["rejects temperature above range", { generationParameters: { temperature: 2.1 } }],
    ["rejects topP below range", { generationParameters: { topP: -0.1 } }],
    ["rejects max output tokens below range", { generationParameters: { maxOutputTokens: 63 } }],
    [
      "rejects unknown nested keys",
      {
        generationParameters: {
          extra: true,
        },
      },
    ],
  ])("%s", (_label, patch) => {
    const candidate = {
      ...validContent,
      ...patch,
      generationParameters: {
        ...validContent.generationParameters,
        ...(patch as { generationParameters?: Record<string, unknown> })
          .generationParameters,
      },
    };

    if ("exampleConversations" in patch) {
      candidate.exampleConversations = patch.exampleConversations as typeof validContent.exampleConversations;
    }

    expect(characterContentSchema.safeParse(candidate).success).toBe(false);
  });
});
