import { beforeEach, describe, expect, test, vi } from "vitest";
import { ChatDomainError } from "@/server/chat/chat-errors";
import {
  getConversationForUser,
  listActiveConversations,
} from "@/server/chat/conversation-queries";
import { createConversationService } from "@/server/chat/conversation-service";
import {
  deleteConversationAction,
  restartConversationAction,
  startConversationAction,
} from "./actions";

const mocks = vi.hoisted(() => {
  const redirectError = new Error("NEXT_REDIRECT");
  return {
    redirectError,
    revalidatePath: vi.fn(),
    redirect: vi.fn(() => {
      throw redirectError;
    }),
    service: {
      openOrCreate: vi.fn(),
      restart: vi.fn(),
      delete: vi.fn(),
    },
    requireSession: vi.fn(async () => ({ user: { id: "user-1" } })),
  };
});

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers([["cookie", "session=1"]]),
}));
vi.mock("@/server/auth/require-session", () => ({
  requireSession: mocks.requireSession,
}));
vi.mock("@/server/db/database", () => ({
  getDatabase: vi.fn(async () => ({})),
}));
vi.mock("@/server/chat/conversation-service", () => ({
  createConversationService: vi.fn(),
}));
vi.mock("@/server/chat/conversation-queries", () => ({
  getConversationForUser: vi.fn(),
  listActiveConversations: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(createConversationService).mockReturnValue(mocks.service);
  vi.mocked(listActiveConversations).mockResolvedValue([]);
});

describe("startConversationAction", () => {
  test("opens the owned active conversation and redirects only after success", async () => {
    mocks.service.openOrCreate.mockResolvedValue({
      conversationId: "conversation-1",
      created: false,
    });

    await expect(
      startConversationAction(
        "character-1",
        "calm-guide",
        { status: "idle" },
        new FormData(),
      ),
    ).rejects.toBe(mocks.redirectError);

    expect(mocks.service.openOrCreate).toHaveBeenCalledWith({
      userId: "user-1",
      characterId: "character-1",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/app");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/characters/calm-guide");
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/app/conversations/conversation-1",
    );
    expect(mocks.redirect).toHaveBeenCalledWith(
      "/app/conversations/conversation-1",
    );
  });

  test("maps domain failures to safe state without redirecting", async () => {
    mocks.service.openOrCreate.mockRejectedValue(
      new ChatDomainError("CHAT_READ_ONLY", "private lifecycle detail"),
    );

    await expect(
      startConversationAction(
        "character-1",
        "calm-guide",
        { status: "idle" },
        new FormData(),
      ),
    ).resolves.toEqual({
      status: "error",
      message: "This chat is read-only.",
    });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

test("restart requires confirmation, archives through the service, and redirects to the new ID", async () => {
  const unconfirmed = await restartConversationAction(
    "conversation-old",
    "calm-guide",
    { status: "idle" },
    new FormData(),
  );
  expect(unconfirmed).toEqual({
    status: "error",
    message: "Confirm that you want to start over.",
  });
  expect(mocks.service.restart).not.toHaveBeenCalled();
  expect(mocks.requireSession).toHaveBeenCalledOnce();

  mocks.service.restart.mockResolvedValue({ conversationId: "conversation-new" });
  const confirmed = new FormData();
  confirmed.set("confirm", "on");
  await expect(
    restartConversationAction(
      "conversation-old",
      "calm-guide",
      { status: "idle" },
      confirmed,
    ),
  ).rejects.toBe(mocks.redirectError);

  expect(mocks.service.restart).toHaveBeenCalledWith({
    userId: "user-1",
    conversationId: "conversation-old",
  });
  expect(mocks.revalidatePath).toHaveBeenCalledWith(
    "/app/conversations/conversation-old",
  );
  expect(mocks.revalidatePath).toHaveBeenCalledWith(
    "/app/conversations/conversation-new",
  );
  expect(mocks.redirect).toHaveBeenCalledWith(
    "/app/conversations/conversation-new",
  );
});

test.each([
  ["active", "/app"],
  ["archived", "/app/conversations/conversation-current"],
] as const)(
  "confirmed %s deletion returns to the correct page",
  async (lifecycle, expectedRedirect) => {
    vi.mocked(getConversationForUser).mockResolvedValue({
      id: "conversation-delete",
      lifecycle,
      character: {
        id: "character-1",
        slug: "calm-guide",
        displayName: "Calm Guide",
        avatarPath: "/calm.svg",
        pinnedVersionId: "version-1",
        isCurrentDefault: true,
      },
      messages: [],
    });
    vi.mocked(listActiveConversations).mockResolvedValue(
      lifecycle === "archived"
        ? [
            {
              id: "conversation-current",
              character: {
                id: "character-1",
                slug: "calm-guide",
                displayName: "Calm Guide",
                avatarPath: "/calm.svg",
                pinnedVersionId: "version-2",
                isCurrentDefault: true,
              },
              lastMessageAt: new Date(),
            },
          ]
        : [],
    );
    const form = new FormData();
    form.set("confirm", "on");

    await expect(
      deleteConversationAction(
        "conversation-delete",
        { status: "idle" },
        form,
      ),
    ).rejects.toBe(mocks.redirectError);

    expect(mocks.service.delete).toHaveBeenCalledWith({
      userId: "user-1",
      conversationId: "conversation-delete",
    });
    expect(mocks.redirect).toHaveBeenCalledWith(expectedRedirect);
  },
);
