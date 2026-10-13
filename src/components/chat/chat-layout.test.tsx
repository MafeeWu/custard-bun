import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, expect, test, vi } from "vitest";
import type { UserConversationDetail } from "@/server/chat/conversation-queries";
import { ChatScreen } from "./chat-screen";
import { ChatComposer, type ChatClientMessage } from "./chat-composer";
import { ChatTimeline } from "./chat-timeline";
import { messageMotionKey } from "./chat-message-motion";

const action = vi.fn(async () => ({ status: "success" as const }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>();
  return { ...actual, useReducedMotion: () => false };
});

beforeAll(() => {
  const prototype = HTMLDialogElement.prototype as HTMLDialogElement & {
    showModal?: () => void;
    close?: () => void;
  };

  if (!prototype.showModal) {
    Object.defineProperty(prototype, "showModal", {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.open = true;
        this.setAttribute("open", "");
      },
    });
  }

  if (!prototype.close) {
    Object.defineProperty(prototype, "close", {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.open = false;
        this.removeAttribute("open");
      },
    });
  }
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
    ],
    ...overrides,
  };
}

function loadChatStyles() {
  const style = document.createElement("style");
  style.textContent = readFileSync("src/app/globals.css", "utf8").replace(
    /@import[^;]+;/g,
    "",
  );
  document.head.append(style);
  return style;
}

function cssRule(style: HTMLStyleElement, selector: string) {
  return [...style.sheet!.cssRules].find(
    (rule) => rule instanceof CSSStyleRule && rule.selectorText === selector,
  ) as CSSStyleRule | undefined;
}

test("history drawer opens accessibly, closes on Escape, and restores focus", async () => {
  const user = userEvent.setup();
  render(
    <ChatScreen
      conversation={conversation()}
      archivedConversations={[
        {
          id: "conversation-archived",
          character: {
            id: "character-1",
            slug: "calm-guide",
            displayName: "Calm Guide",
            avatarPath: "/characters/calm-old.svg",
            pinnedVersionId: "version-old",
            isCurrentDefault: false,
          },
          archivedAt: new Date("2026-10-08T12:00:00Z"),
          lastMessageAt: new Date("2026-10-08T12:00:00Z"),
        },
      ]}
      restartAction={action}
      deleteAction={action}
    />,
  );

  await user.click(
    screen.getByRole("button", { name: "Open conversation history" }),
  );
  expect(
    screen.getByRole("dialog", { name: "Conversation history" }),
  ).toBeVisible();
  expect(screen.getByRole("link", { name: /Calm Guide/ })).toHaveAttribute(
    "href",
    "/app/conversations/conversation-archived",
  );

  await user.keyboard("{Escape}");

  expect(
    screen.queryByRole("dialog", { name: "Conversation history" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Open conversation history" }),
  ).toHaveFocus();
});

test("conversation actions open separately and visually separate destructive work", async () => {
  const user = userEvent.setup();
  render(
    <ChatScreen
      conversation={conversation()}
      archivedConversations={[]}
      restartAction={action}
      deleteAction={action}
    />,
  );

  await user.click(
    screen.getByRole("button", { name: "Open conversation actions" }),
  );

  expect(
    screen.getByRole("dialog", { name: "Conversation actions" }),
  ).toBeVisible();
  expect(
    screen.getByLabelText("Archive this conversation and start over."),
  ).toHaveAttribute("name", "confirm");
  const dangerZone = screen.getByRole("group", { name: "Danger zone" });
  expect(dangerZone).toHaveClass("chat-actions__danger-zone");
  expect(dangerZone).toContainElement(
    screen.getByLabelText(/Permanently delete this conversation/),
  );
});

test("composer and timeline CSS reserve safe mobile space without fixed-width controls", () => {
  const style = loadChatStyles();
  try {
    render(
      <ChatComposer
        conversationId="conversation-1"
        messages={[]}
        onMessagesChange={() => {}}
      />,
    );

    expect(
      getComputedStyle(screen.getByLabelText("Message")).maxHeight,
    ).not.toBe("none");
    expect(getComputedStyle(screen.getByLabelText("Message")).overflowY).toBe(
      "auto",
    );
    expect(getComputedStyle(screen.getByLabelText("Message")).resize).toBe(
      "none",
    );
    expect(
      getComputedStyle(document.querySelector(".chat-composer-shell")!)
        .position,
    ).toBe("sticky");

    const composerShellRule = cssRule(style, ".chat-composer-shell");
    expect(
      composerShellRule?.style.getPropertyValue("padding-bottom"),
    ).toContain("safe-area-inset-bottom");
    const timelineRule = cssRule(style, ".chat-timeline");
    expect(timelineRule?.style.getPropertyValue("padding-bottom")).toBe(
      "var(--chat-composer-reserved)",
    );
    const composerRule = cssRule(style, ".chat-composer");
    expect(
      composerRule?.style.getPropertyValue("grid-template-columns"),
    ).toContain("minmax(0, 1fr)");

    const fixedControlWidthRule = [...style.sheet!.cssRules].find(
      (rule) =>
        rule instanceof CSSStyleRule &&
        /chat-(composer|header|actions)/.test(rule.selectorText) &&
        /(^|;)\s*width:\s*\d+(px|rem)/.test(rule.cssText),
    );
    expect(fixedControlWidthRule).toBeUndefined();
  } finally {
    style.remove();
  }
});

test("messages expose semantic presentation classes and stable non-content motion keys", () => {
  const messages: ChatClientMessage[] = [
    {
      id: "assistant-message-id",
      role: "assistant",
      kind: "opening",
      content: "Private assistant text",
    },
    {
      id: "user-message-id",
      role: "user",
      kind: "user",
      content: "Private user text",
    },
    {
      id: "status-message-id",
      role: "assistant",
      kind: "generated",
      attemptId: "attempt-1",
      status: "complete",
      content: "Complete assistant text",
      errorCode: null,
      retryable: false,
    },
  ];

  render(<ChatTimeline messages={messages} />);

  expect(
    screen.getAllByLabelText("Character message")[0].closest("li"),
  ).toHaveClass("chat-message--assistant");
  expect(screen.getByLabelText("Your message").closest("li")).toHaveClass(
    "chat-message--user",
  );
  const statusMessage = screen
    .getByText("Complete assistant text")
    .closest("li");
  expect(statusMessage).toHaveClass("chat-message--generated");
  expect(statusMessage).toHaveAttribute("data-status", "complete");
  expect(messageMotionKey(messages[0])).toBe("assistant-message-id");
  expect(messageMotionKey(messages[0])).not.toContain("Private assistant text");
  for (const className of Array.from(statusMessage!.classList)) {
    expect(className).not.toContain("Complete");
    expect(className).not.toContain("assistant text");
  }
});

test("authoritative server transcripts do not enter even with optimistic-looking ids", () => {
  render(
    <ChatScreen
      conversation={conversation({
        messages: [
          {
            id: "user-server-snapshot",
            role: "user",
            kind: "user",
            content: "Persisted user text",
          },
          {
            id: "attempt-server-snapshot",
            role: "assistant",
            kind: "generated",
            attemptId: "server-snapshot",
            status: "complete",
            content: "Persisted assistant text",
            errorCode: null,
            retryable: false,
          },
        ],
      })}
      archivedConversations={[]}
      restartAction={action}
      deleteAction={action}
    />,
  );

  expect(
    screen.getByText("Persisted user text").closest("li"),
  ).not.toHaveAttribute("data-motion");
  expect(
    screen.getByText("Persisted assistant text").closest("li"),
  ).not.toHaveAttribute("data-motion");
});

test("authoritative refreshes do not re-enter but client-only user and attempt messages do", async () => {
  const user = userEvent.setup();
  const firstConversation = conversation({
    messages: [
      {
        id: "user-refresh-snapshot",
        role: "user",
        kind: "user",
        content: "Before refresh",
      },
    ],
  });
  const props = {
    archivedConversations: [],
    restartAction: action,
    deleteAction: action,
  };
  const { rerender } = render(
    <ChatScreen conversation={firstConversation} {...props} />,
  );
  rerender(
    <ChatScreen
      conversation={conversation({
        messages: [
          {
            id: "user-refresh-snapshot",
            role: "user",
            kind: "user",
            content: "Before refresh",
          },
          {
            id: "attempt-refresh-snapshot",
            role: "assistant",
            kind: "generated",
            attemptId: "refresh-snapshot",
            status: "complete",
            content: "After refresh",
            errorCode: null,
            retryable: false,
          },
        ],
      })}
      {...props}
    />,
  );

  expect(screen.getByText("After refresh").closest("li")).not.toHaveAttribute(
    "data-motion",
  );

  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              const encoder = new TextEncoder();
              controller.enqueue(
                encoder.encode(
                  '{"type":"started","attemptId":"client-inserted"}\n{"type":"delta","attemptId":"client-inserted","text":"Client reply"}\n{"type":"completed","attemptId":"client-inserted","usage":{"inputTokens":1,"outputTokens":1,"estimated":false}}\n',
                ),
              );
              controller.close();
            },
          }),
        ),
    ),
  );
  vi.spyOn(crypto, "randomUUID").mockReturnValue("client-request-id");

  await user.type(screen.getByLabelText("Message"), "Client message");
  await user.click(screen.getByRole("button", { name: "Send" }));

  expect(await screen.findByText("Client message")).toBeVisible();
  expect(screen.getByText("Client message").closest("li")).toHaveAttribute(
    "data-motion",
    "standard",
  );
  expect(await screen.findByText("Client reply")).toBeVisible();
  expect(screen.getByText("Client reply").closest("li")).toHaveAttribute(
    "data-motion",
    "standard",
  );
});
