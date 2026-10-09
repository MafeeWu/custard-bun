import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { requireSession } from "@/server/auth/require-session";
import { listActiveConversations } from "@/server/chat/conversation-queries";
import ApplicationHomePage from "./page";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

vi.mock("@/server/auth/require-session", () => ({
  requireSession: vi.fn(),
}));

vi.mock("@/server/db/database", () => ({
  getDatabase: vi.fn(async () => ({})),
}));

vi.mock("@/server/chat/conversation-queries", () => ({
  listActiveConversations: vi.fn(),
}));

vi.mock("@/components/auth/sign-out-button", () => ({
  SignOutButton: () => <button type="button">Sign out</button>,
}));

test("renders account and character catalog navigation from the application page", async () => {
  vi.mocked(requireSession).mockResolvedValue({
    user: {
      name: "Person",
      email: "person@example.com",
      emailVerified: true,
    },
  } as never);
  vi.mocked(listActiveConversations).mockResolvedValue([
    {
      id: "conversation-1",
      character: {
        id: "character-1",
        slug: "calm-guide",
        displayName: "Calm Guide",
        avatarPath: "/calm.svg",
        pinnedVersionId: "version-1",
        isCurrentDefault: true,
      },
      lastMessageAt: new Date("2026-10-09T10:00:00Z"),
    },
  ]);

  const element = await ApplicationHomePage();
  render(element);

  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
    "Welcome, Person",
  );
  expect(screen.getByRole("link", { name: "Account" })).toHaveAttribute(
    "href",
    "/account",
  );
  expect(
    screen.getByRole("link", { name: /browse characters/i }),
  ).toHaveAttribute("href", "/characters");
  expect(
    screen.getByRole("link", { name: /continue with calm guide/i }),
  ).toHaveAttribute("href", "/app/conversations/conversation-1");
});
