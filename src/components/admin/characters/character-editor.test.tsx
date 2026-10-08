import { render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { CharacterContent } from "@/server/characters/character-content";
import { CharacterEditor } from "./character-editor";

const content: CharacterContent = {
  displayName: "Calm Guide",
  avatarPath: "/characters/calm-listener.svg",
  shortDescription: "A steady companion.",
  longDescription: "A patient companion for reflective conversations.",
  personalityPrinciples: ["Reflect first."],
  speakingStyle: "Warm and concise.",
  responseRhythm: "Pause, reflect, then ask.",
  relationshipBoundaries: ["Do not claim to be human."],
  openingMessage: "What feels most important right now?",
  exampleConversations: [
    { user: "I feel stuck.", assistant: "Let's name it." },
  ],
  generationParameters: { temperature: 0.6, topP: 0.9, maxOutputTokens: 700 },
  safetyAdditions: ["Suggest emergency help for immediate danger."],
};

test("renders one editor for every character content field with exact form names", () => {
  render(
    <CharacterEditor
      mode="edit"
      characterId="char-1"
      slug="calm-guide"
      draftRevision={3}
      content={content}
      action={vi.fn()}
      state={{ status: "idle" }}
    />,
  );

  for (const label of [
    "Display name",
    "Avatar path",
    "Short description",
    "Long description",
    "Personality principles",
    "Speaking style",
    "Response rhythm",
    "Relationship boundaries",
    "Opening message",
    "Example user 1",
    "Example assistant 1",
    "Temperature",
    "Top P",
    "Max output tokens",
    "Safety additions",
  ]) {
    expect(screen.getByLabelText(label)).toBeVisible();
  }
  expect(screen.getByDisplayValue("3")).toHaveAttribute(
    "name",
    "expectedRevision",
  );
  expect(screen.getByDisplayValue("I feel stuck.")).toHaveAttribute(
    "name",
    "exampleUser",
  );
  expect(screen.getByDisplayValue("Let's name it.")).toHaveAttribute(
    "name",
    "exampleAssistant",
  );
});

test("shows visible field errors and operation status while keeping preview and publish separate", () => {
  render(
    <CharacterEditor
      mode="edit"
      characterId="char-1"
      slug="calm-guide"
      draftRevision={3}
      content={content}
      action={vi.fn()}
      publishAction={vi.fn()}
      state={{
        status: "error",
        message: "Check fields",
        fieldErrors: { temperature: ["Temperature must be a valid number."] },
      }}
    />,
  );

  expect(screen.getByRole("alert")).toHaveTextContent("Check fields");
  expect(screen.getByText("Temperature must be a valid number.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Save draft" })).toBeVisible();
  expect(
    screen.getByRole("link", { name: "Preview persisted draft" }),
  ).toHaveAttribute("href", "/admin/characters/char-1/preview");
  expect(screen.getByRole("button", { name: "Publish draft" })).toBeVisible();
  expect(
    screen.queryByRole("button", { name: /delete/i }),
  ).not.toBeInTheDocument();
});
