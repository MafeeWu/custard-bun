import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { CharacterProfile } from "./character-profile";

test("renders the public character detail with structured sections and an in-header primary action", () => {
  render(
    <CharacterProfile
      action={
        <a href="/auth/sign-in?returnTo=%2Fcharacters%2Fcalm-listener">
          Sign in to start a conversation
        </a>
      }
      character={{
        id: "11111111-1111-1111-1111-111111111111",
        slug: "calm-listener",
        displayName:
          "Calm Listener for Slower, Honest Conversations That Need Room to Land",
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
        openingMessage:
          "We can stay with the part that still feels unresolved, move carefully, and let the next step arrive after the pattern gets clearer.",
      }}
    />,
  );

  expect(
    screen.getByRole("heading", {
      level: 1,
      name: "Calm Listener for Slower, Honest Conversations That Need Room to Land",
    }),
  ).toBeVisible();
  expect(screen.getByAltText(/Calm Listener for Slower/)).toHaveAttribute(
    "src",
    "/characters/calm-listener.svg",
  );
  expect(
    screen.getByText("A patient character for careful reflection."),
  ).toBeVisible();
  expect(
    screen.getByText(/we can stay with the part that still feels unresolved/i),
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
  const identity = screen
    .getByRole("heading", {
      level: 1,
      name: "Calm Listener for Slower, Honest Conversations That Need Room to Land",
    })
    .closest(".character-profile__identity");
  expect(identity).toContainElement(
    screen.getByRole("link", {
      name: "Sign in to start a conversation",
    }),
  );
});

test("falls back to initials on the profile surface when the avatar path is not repository-owned", () => {
  render(
    <CharacterProfile
      action={<button type="button">Start conversation</button>}
      character={{
        id: "22222222-2222-2222-2222-222222222222",
        slug: "remote-listener",
        displayName: "Remote Listener",
        avatarPath: "https://example.com/remote-listener.png",
        shortDescription: "A steady presence.",
        longDescription: "Still visible without a local portrait.",
        personalityPrinciples: ["Stay grounded."],
        speakingStyle: "Measured and calm.",
        responseRhythm: "Leaves room before responding.",
        relationshipBoundaries: ["Never present a remote avatar path."],
        openingMessage: "We can start carefully and keep the frame local.",
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
