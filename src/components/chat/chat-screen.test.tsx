import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { UserConversationDetail } from "@/server/chat/conversation-queries";
import { ChatScreen } from "./chat-screen";

const action = vi.fn(async () => ({ status: "success" as const }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

test("memory entry targets the current character and deletion explains retained memory and cancelled sources", () => {
  render(
    <ChatScreen
      conversation={conversation({ messages: [] })}
      archivedConversations={[]}
      restartAction={action}
      deleteAction={action}
    />,
  );
  expect(screen.getByRole("link", { name: "Manage memory" })).toHaveAttribute(
    "href",
    "/app/memories/character-1",
  );
  expect(
    screen
      .getByLabelText(/Permanently delete this conversation/)
      .closest("label"),
  ).toHaveTextContent(
    "Existing long-term memory is retained. Unapplied extraction from this conversation is cancelled. The deleted transcript cannot later form memory.",
  );
});

function conversation(
  overrides: Partial<UserConversationDetail> = {},
): UserConversationDetail {
  return {
    id: "conversation-1",
    lifecycle: "active",
    character: {
      id: "character-1",
      slug: "calm-guide",
      displayName: "Calm Guide",
      avatarPath: "/characters/calm.svg",
      pinnedVersionId: "version-1",
      isCurrentDefault: true,
    },
    messages: [
      {
        id: "opening",
        role: "assistant",
        kind: "opening",
        content: "Welcome.",
      },
      { id: "user", role: "user", kind: "user", content: "Hello." },
      {
        id: "pending",
        role: "assistant",
        kind: "generated",
        attemptId: "attempt-pending",
        status: "pending",
        content: "",
        errorCode: null,
        retryable: false,
      },
      {
        id: "streaming",
        role: "assistant",
        kind: "generated",
        attemptId: "attempt-streaming",
        status: "streaming",
        content: "A partial reply",
        errorCode: null,
        retryable: false,
      },
      {
        id: "complete",
        role: "assistant",
        kind: "generated",
        attemptId: "attempt-complete",
        status: "complete",
        content: "A complete reply",
        errorCode: null,
        retryable: false,
      },
      {
        id: "failed",
        role: "assistant",
        kind: "generated",
        attemptId: "attempt-failed",
        status: "failed",
        content: "",
        errorCode: "CHAT_PROVIDER_RATE_LIMIT",
        retryable: true,
      },
      {
        id: "interrupted",
        role: "assistant",
        kind: "generated",
        attemptId: "attempt-interrupted",
        status: "interrupted",
        content: "Preserved partial reply",
        errorCode: "CHAT_STREAM_INTERRUPTED",
        retryable: true,
      },
    ],
    ...overrides,
  };
}

test("a server refresh replaces stale local messages with the authoritative recovered transcript", () => {
  const original = conversation({
    messages: [
      {
        id: "assistant",
        role: "assistant",
        kind: "generated",
        attemptId: "stale",
        status: "streaming",
        content: "Partial",
        errorCode: null,
        retryable: false,
      },
    ],
  });
  const props = {
    archivedConversations: [],
    restartAction: action,
    deleteAction: action,
  };
  const { rerender } = render(
    <ChatScreen conversation={original} {...props} />,
  );
  expect(screen.getByLabelText("Message")).toBeDisabled();
  rerender(
    <ChatScreen
      conversation={conversation({
        messages: [
          {
            id: "assistant",
            role: "assistant",
            kind: "generated",
            attemptId: "stale",
            status: "interrupted",
            content: "Durable partial",
            errorCode: "CHAT_STREAM_INTERRUPTED",
            retryable: true,
          },
        ],
      })}
      {...props}
    />,
  );
  expect(screen.getByText("Durable partial")).toBeVisible();
  expect(screen.getByLabelText("Message")).toBeEnabled();
  expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
});

test("renders focused opening, user, streaming, complete, failed, and interrupted states", () => {
  render(
    <ChatScreen
      conversation={conversation()}
      archivedConversations={[]}
      restartAction={action}
      deleteAction={action}
    />,
  );

  expect(
    screen.getByRole("region", { name: "Conversation" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Welcome.")).toBeVisible();
  expect(screen.getByText("Hello.")).toBeVisible();
  expect(screen.getByText("Waiting for a reply…")).toBeVisible();
  expect(screen.getByText("A partial reply")).toBeVisible();
  expect(screen.getByText("A complete reply")).toBeVisible();
  expect(
    screen.getByText("The model provider is rate limiting requests."),
  ).toBeVisible();
  expect(screen.getByText("Preserved partial reply")).toBeVisible();
  expect(
    screen.getByText("The response stream ended before completion."),
  ).toBeVisible();
  expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(2);
  expect(screen.getByRole("button", { name: "Stop" })).toBeVisible();
  expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
});

test("renders archived conversations as read-only with delete and back actions", () => {
  render(
    <ChatScreen
      conversation={conversation({
        lifecycle: "archived",
        messages: conversation().messages.slice(0, 2),
      })}
      archivedConversations={[]}
      activeConversationId="conversation-current"
      restartAction={action}
      deleteAction={action}
    />,
  );

  expect(
    screen.getByRole("status", {
      name: "",
    }),
  ).toHaveTextContent("This archived conversation is read-only.");
  expect(
    screen.queryByRole("button", { name: "Send" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "Back to current conversation" }),
  ).toHaveAttribute("href", "/app/conversations/conversation-current");
  expect(
    screen.getByRole("button", { name: "Delete conversation" }),
  ).toBeVisible();
});

test("shows a version notice without exposing model configuration", () => {
  render(
    <ChatScreen
      conversation={conversation({
        character: {
          ...conversation().character,
          isCurrentDefault: false,
        },
        messages: conversation().messages.slice(0, 2),
      })}
      archivedConversations={[]}
      restartAction={action}
      deleteAction={action}
    />,
  );

  expect(
    screen.getByText(
      "This conversation keeps the character version it started with. Start over to use the current version.",
    ),
  ).toBeVisible();
  expect(
    screen.queryByText(/model id|api key|base url/i),
  ).not.toBeInTheDocument();
});
