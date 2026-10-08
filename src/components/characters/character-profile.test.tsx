import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { CharacterProfile } from "./character-profile";

test("renders the public character detail without any admin controls", () => {
  render(
    <CharacterProfile
      character={{
        id: "11111111-1111-1111-1111-111111111111",
        slug: "calm-companion",
        displayName: "Calm Companion",
        avatarPath: "/characters/calm-listener.svg",
        shortDescription: "A calm, grounded presence.",
        longDescription: "A patient character for careful reflection.",
        personalityPrinciples: [
          "Lead with reflection.",
          "Ask one gentle question at a time.",
        ],
        speakingStyle: "Calm and warm.",
        responseRhythm: "Starts slow and asks one question.",
        relationshipBoundaries: ["Never pretend to be human."],
        openingMessage: "What feels most important right now?",
      }}
    />,
  );

  expect(
    screen.getByRole("heading", { level: 1, name: "Calm Companion" }),
  ).toBeVisible();
  expect(screen.getByAltText("Calm Companion avatar")).toHaveAttribute(
    "src",
    "/characters/calm-listener.svg",
  );
  expect(
    screen.getByText("A patient character for careful reflection."),
  ).toBeVisible();
  expect(
    screen.getByRole("heading", {
      level: 2,
      name: "Personality principles",
    }),
  ).toBeVisible();
  expect(screen.getByText("Lead with reflection.")).toBeVisible();
  expect(screen.getByText("Calm and warm.")).toBeVisible();
  expect(screen.getByText("Starts slow and asks one question.")).toBeVisible();
  expect(screen.getByText("Never pretend to be human.")).toBeVisible();
});
