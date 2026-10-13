import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { ConversationCard } from "./conversation-card";

test("renders one accessible continuation link with explicit avatar dimensions and continuation copy", () => {
  render(
    <ConversationCard
      character={{
        displayName: "Calm Guide",
        avatarPath: "/characters/calm-guide.svg",
      }}
      id="conversation-1"
    />,
  );

  const link = screen.getByRole("link", { name: "Continue with Calm Guide" });
  const avatar = screen.getByRole("img", { name: "Calm Guide avatar" });

  expect(link).toHaveAttribute("href", "/app/conversations/conversation-1");
  expect(screen.getByText("Active conversation")).toBeVisible();
  expect(screen.getByText("Calm Guide")).toBeVisible();
  expect(screen.getByText("Continue with Calm Guide")).toBeVisible();
  expect(avatar).toHaveAttribute("width", "72");
  expect(avatar).toHaveAttribute("height", "72");
});
