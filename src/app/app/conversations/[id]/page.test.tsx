import { render, screen } from "@testing-library/react";
import { notFound } from "next/navigation";
import { expect, test, vi } from "vitest";
import {
  getConversationForUser,
  listActiveConversations,
  listArchivedCharacterConversations,
} from "@/server/chat/conversation-queries";
import ConversationPage from "./page";

vi.mock("next/headers", () => ({
  headers: async () => new Headers([["cookie", "session=1"]]),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("@/server/auth/require-session", () => ({
  requireSession: vi.fn(async () => ({ user: { id: "user-1" } })),
}));
vi.mock("@/server/db/database", () => ({
  getDatabase: vi.fn(async () => ({})),
}));
vi.mock("@/server/chat/conversation-queries", () => ({
  getConversationForUser: vi.fn(),
  listActiveConversations: vi.fn(),
  listArchivedCharacterConversations: vi.fn(),
}));

test("loads only the owned conversation and character history into the focused page", async () => {
  vi.mocked(getConversationForUser).mockResolvedValue({
    id: "conversation-1",
    lifecycle: "active",
    character: {
      id: "character-1",
      slug: "calm-guide",
      displayName: "Calm Guide",
      avatarPath: "/calm.svg",
      pinnedVersionId: "version-1",
      isCurrentDefault: true,
    },
    messages: [
      {
        id: "opening-1",
        role: "assistant",
        kind: "opening",
        content: "Welcome.",
      },
    ],
  });
  vi.mocked(listArchivedCharacterConversations).mockResolvedValue([
    {
      id: "conversation-archived",
      character: {
        id: "character-1",
        slug: "calm-guide",
        displayName: "Calm Guide",
        avatarPath: "/calm-old.svg",
        pinnedVersionId: "version-old",
        isCurrentDefault: false,
      },
      archivedAt: new Date("2026-10-08T12:00:00Z"),
      lastMessageAt: new Date("2026-10-08T12:00:00Z"),
    },
  ]);
  vi.mocked(listActiveConversations).mockResolvedValue([]);

  render(
    await ConversationPage({
      params: Promise.resolve({ id: "conversation-1" }),
    }),
  );

  expect(screen.getByRole("heading", { name: "Calm Guide" })).toBeVisible();
  expect(screen.getByText("Welcome.")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Open conversation history" }),
  ).toBeVisible();
  expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  expect(getConversationForUser).toHaveBeenCalledWith(expect.anything(), {
    userId: "user-1",
    conversationId: "conversation-1",
  });
});

test("returns not found when the conversation is not owned", async () => {
  vi.mocked(getConversationForUser).mockResolvedValue(null);

  await expect(
    ConversationPage({
      params: Promise.resolve({ id: "private-conversation" }),
    }),
  ).rejects.toThrow("NEXT_NOT_FOUND");
  expect(notFound).toHaveBeenCalledOnce();
});
