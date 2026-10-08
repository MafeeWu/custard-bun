import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { CharacterCard } from "./character-card";

test("renders a linked public character summary with accessible text", () => {
  render(
    <CharacterCard
      character={{
        id: "11111111-1111-1111-1111-111111111111",
        slug: "calm-companion",
        displayName: "Calm Companion",
        avatarPath: "/characters/calm-listener.svg",
        shortDescription: "A calm, grounded presence.",
        openingMessage: "What feels most important right now?",
      }}
    />,
  );

  expect(
    screen.getByRole("heading", { level: 2, name: "Calm Companion" }),
  ).toBeVisible();
  expect(screen.getByAltText("Calm Companion avatar")).toHaveAttribute(
    "src",
    "/characters/calm-listener.svg",
  );
  expect(screen.getByText("A calm, grounded presence.")).toBeVisible();
  expect(
    screen.getByRole("link", { name: /calm companion/i }),
  ).toHaveAttribute("href", "/characters/calm-companion");
});
