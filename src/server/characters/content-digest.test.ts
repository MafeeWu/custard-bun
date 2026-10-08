import { expect, test, describe } from "vitest";
import {
  changedCharacterFieldGroups,
  characterContentDigest,
} from "./content-digest";

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

describe("character content digest", () => {
  test("is stable when object key insertion order changes", () => {
    const reorderedContent = {
      safetyAdditions: [...validContent.safetyAdditions],
      generationParameters: {
        maxOutputTokens: 800,
        topP: 0.9,
        temperature: 0.7,
      },
      exampleConversations: [...validContent.exampleConversations],
      openingMessage: validContent.openingMessage,
      relationshipBoundaries: [...validContent.relationshipBoundaries],
      responseRhythm: validContent.responseRhythm,
      speakingStyle: validContent.speakingStyle,
      personalityPrinciples: [...validContent.personalityPrinciples],
      longDescription: validContent.longDescription,
      shortDescription: validContent.shortDescription,
      avatarPath: validContent.avatarPath,
      displayName: validContent.displayName,
    };

    expect(characterContentDigest(reorderedContent)).toBe(
      characterContentDigest(validContent),
    );
  });

  test("changes when array order changes", () => {
    expect(
      characterContentDigest({
        ...validContent,
        personalityPrinciples: [...validContent.personalityPrinciples].reverse(),
      }),
    ).not.toBe(characterContentDigest(validContent));
  });

  test("reports only changed top-level field groups", () => {
    expect(
      changedCharacterFieldGroups(validContent, {
        ...validContent,
        openingMessage: "Take your time. What happened?",
      }),
    ).toEqual(["openingMessage"]);
  });

  test("produces a sha256 digest", () => {
    expect(characterContentDigest(validContent)).toMatch(/^[a-f0-9]{64}$/);
  });
});
