import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { CharacterCard } from "./character-card";

test("renders a featured public character card with a repository-owned portrait and visible opening voice", () => {
  render(
    <CharacterCard
      emphasis="featured"
      character={{
        id: "11111111-1111-1111-1111-111111111111",
        slug: "calm-listener",
        displayName: "Calm Listener",
        avatarPath: "/characters/calm-listener.svg",
        shortDescription: "A calm, grounded presence.",
        openingMessage:
          "What feels most important right now, and where would it help if we slowed the pace down together before choosing a next step?",
      }}
    />,
  );

  expect(
    screen.getByRole("heading", { level: 2, name: "Calm Listener" }),
  ).toBeVisible();
  expect(screen.getByRole("link", { name: /calm listener/i })).toHaveAttribute(
    "href",
    "/characters/calm-listener",
  );
  expect(screen.getByRole("link", { name: /calm listener/i })).toHaveAttribute(
    "data-emphasis",
    "featured",
  );
  expect(
    screen.getByRole("img", { name: "Calm Listener avatar" }),
  ).toHaveAttribute("width", "160");
  expect(screen.getByAltText("Calm Listener avatar")).toHaveAttribute(
    "src",
    "/characters/calm-listener.svg",
  );
  expect(screen.getByText("A calm, grounded presence.")).toBeVisible();
  expect(
    screen.getByText(
      /what feels most important right now, and where would it help if we slowed the pace down together/i,
    ),
  ).toBeVisible();
});

test("falls back to initials instead of rendering a remote avatar path", () => {
  render(
    <CharacterCard
      character={{
        id: "22222222-2222-2222-2222-222222222222",
        slug: "remote-listener",
        displayName: "Remote Listener",
        avatarPath: "https://example.com/remote-listener.png",
        shortDescription: "Should never render a remote portrait in public UI.",
        openingMessage: "Keep my public card inside repository-owned assets.",
      }}
    />,
  );

  expect(
    screen.getByRole("img", { name: "Remote Listener avatar" }).tagName,
  ).toBe("SPAN");
  expect(
    screen.queryByAltText("Remote Listener avatar"),
  ).not.toBeInTheDocument();
});

test("keeps a numbered card heading semantic without adding the number to the link name", () => {
  render(
    <CharacterCard
      index={2}
      character={{
        id: "33333333-3333-3333-3333-333333333333",
        slug: "numbered-listener",
        displayName: "Numbered Listener",
        avatarPath: "/characters/calm-listener.svg",
        shortDescription: "A card whose ordering is visual metadata.",
        openingMessage: "The accessible name should describe the character.",
      }}
    />,
  );

  expect(
    screen.getByRole("heading", { level: 2, name: "Numbered Listener" }),
  ).toBeVisible();
  expect(screen.getByText("Character 3")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  expect(screen.getByRole("link")).not.toHaveAttribute("aria-label");
});
