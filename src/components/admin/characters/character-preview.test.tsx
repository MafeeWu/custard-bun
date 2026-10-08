import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import type { CharacterContent } from "@/server/characters/character-content";
import { CharacterPreview } from "./character-preview";

const draft: CharacterContent = {
  displayName: "Preview Guide",
  avatarPath: "/characters/calm-listener.svg",
  shortDescription: "Preview summary.",
  longDescription: "Preview long description.",
  personalityPrinciples: ["Reflect first."],
  speakingStyle: "Warm.",
  responseRhythm: "Slow.",
  relationshipBoundaries: ["Stay bounded."],
  openingMessage: "Hello from the draft.",
  exampleConversations: [{ user: "Hi", assistant: "Hello" }],
  generationParameters: { temperature: 0.4, topP: 0.8, maxOutputTokens: 512 },
  safetyAdditions: ["Escalate danger."],
};

test("renders persisted draft through shared public card/profile and full structured package", () => {
  render(
    <CharacterPreview
      character={{
        id: "char-1",
        slug: "preview-guide",
        draftRevision: 8,
        draft,
      }}
    />,
  );

  expect(screen.getByRole("link", { name: /preview guide/i })).toHaveAttribute(
    "href",
    "/characters/preview-guide",
  );
  expect(
    screen.getByRole("heading", { level: 1, name: "Preview Guide" }),
  ).toBeVisible();
  expect(screen.getByText("Draft revision 8")).toBeVisible();
  expect(
    screen.getByRole("heading", { name: "Example conversations" }),
  ).toBeVisible();
  expect(screen.getByText("temperature: 0.4")).toBeVisible();
  expect(screen.getByText("Escalate danger.")).toBeVisible();
});
