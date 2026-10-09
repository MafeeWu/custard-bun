import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { UserConversationDetail } from "@/server/chat/conversation-queries";
import {
  ChatComposer,
  consumeChatEventStream,
  type ChatClientMessage,
} from "./chat-composer";
import { ChatTimeline } from "./chat-timeline";

const attemptId = "10000000-0000-4000-8000-000000000001";
const replacementAttemptId = "20000000-0000-4000-8000-000000000002";

function responseFromChunks(chunks: string[]) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }),
    {
      headers: { "content-type": "application/x-ndjson" },
    },
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  vi.spyOn(crypto, "randomUUID").mockReturnValue(
    "30000000-0000-4000-8000-000000000003",
  );
});

afterEach(() => {
  vi.useRealTimers();
});

test("parses NDJSON split across chunks and reports only parsed terminal events", async () => {
  const events: unknown[] = [];
  const result = await consumeChatEventStream(
    responseFromChunks([
      `{"type":"started","attemptId":"${attemptId}"}\n{"type":"del`,
      `ta","attemptId":"${attemptId}","text":"Hello"}\n`,
      `{"type":"completed","attemptId":"${attemptId}","usage":{"inputTokens":1,"outputTokens":1,"estimated":false}}\n`,
    ]),
    (event) => events.push(event),
  );

  expect(events).toEqual([
    { type: "started", attemptId },
    { type: "delta", attemptId, text: "Hello" },
    {
      type: "completed",
      attemptId,
      usage: { inputTokens: 1, outputTokens: 1, estimated: false },
    },
  ]);
  expect(result).toEqual({
    attemptId,
    terminal: "completed",
  });
});

function ComposerHarness({
  initialMessages = [],
  refreshedMessages,
  onRefresh,
}: {
  initialMessages?: ChatClientMessage[];
  refreshedMessages?: ChatClientMessage[];
  onRefresh?: () => ChatClientMessage[] | undefined;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [authoritativeMessages, setAuthoritativeMessages] =
    useState(initialMessages);
  return (
    <>
      <ChatTimeline messages={messages} />
      <ChatComposer
        conversationId="conversation-1"
        messages={messages}
        authoritativeMessages={authoritativeMessages}
        onMessagesChange={setMessages}
        onAuthoritativeRefresh={() => {
          const refreshed = onRefresh?.() ?? refreshedMessages;
          if (refreshed) {
            setAuthoritativeMessages(refreshed);
            setMessages(refreshed);
          }
        }}
      />
    </>
  );
}

function recoveringTranscript(
  status: "streaming" | "complete" | "failed" | "interrupted",
  content: string,
): ChatClientMessage[] {
  return [
    {
      id: "persisted-user",
      role: "user",
      kind: "user",
      content: "Lost before started",
    },
    {
      id: "persisted-assistant",
      role: "assistant",
      kind: "generated",
      attemptId,
      status,
      content,
      errorCode:
        status === "failed" || status === "interrupted"
          ? "CHAT_STREAM_INTERRUPTED"
          : null,
      retryable: status === "failed" || status === "interrupted",
    },
  ];
}

function activeReplayResponse(includeAttemptId = true) {
  return Response.json(
    {
      error: {
        code: "CHAT_GENERATION_IN_PROGRESS",
        message: "A response is already being generated for this chat.",
        retryable: true,
        metadata: {
          conversationId: "conversation-1",
          ...(includeAttemptId ? { attemptId } : {}),
        },
      },
    },
    { status: 409 },
  );
}

test.each(["complete", "failed", "interrupted"] as const)(
  "recovers an active identical replay after pre-start transport loss and re-enables on authoritative %s",
  async (terminalStatus) => {
    const user = userEvent.setup();
    const bodies: string[] = [];
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      bodies.push(String(init?.body));
      if (bodies.length === 1) {
        throw new TypeError("admitted response lost before started");
      }
      return activeReplayResponse();
    });
    let transcript = recoveringTranscript("streaming", "Durable partial");
    const refresh = vi.fn(() => transcript);
    render(<ComposerHarness onRefresh={refresh} />);

    await user.type(screen.getByLabelText("Message"), "Lost before started");
    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });
    expect(screen.getByLabelText("Message")).toBeEnabled();
    expect(screen.getByLabelText("Message")).toHaveValue("Lost before started");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });

    expect(screen.getByText("Durable partial")).toBeVisible();
    expect(screen.getByLabelText("Message")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Stop" })).toBeEnabled();
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toBe(bodies[0]);
    transcript = recoveringTranscript(terminalStatus, "Durable final content");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(screen.getByText("Durable final content")).toBeVisible();
    expect(screen.queryByText("Durable partial")).not.toBeInTheDocument();
    expect(screen.getAllByText("Lost before started")).toHaveLength(1);
    expect(screen.getByLabelText("Message")).toBeEnabled();
    expect(screen.getByLabelText("Message")).toHaveValue("");
    expect(
      screen.queryByRole("button", { name: "Stop" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Recovering the active response/),
    ).not.toBeInTheDocument();
    const refreshCount = refresh.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(refresh).toHaveBeenCalledTimes(refreshCount);
    expect(fetch).toHaveBeenCalledTimes(2);
  },
);

test("bounds replay recovery, waits for authoritative identity before offering stop, and cancels polling on unmount", async () => {
  const user = userEvent.setup();
  vi.mocked(fetch).mockResolvedValue(activeReplayResponse(false));
  const refresh = vi.fn(() => undefined);
  const { unmount } = render(<ComposerHarness onRefresh={refresh} />);

  await user.type(screen.getByLabelText("Message"), "Lost before started");
  vi.useFakeTimers();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
  });
  expect(screen.getByLabelText("Message")).toBeDisabled();
  expect(
    screen.queryByRole("button", { name: "Stop" }),
  ).not.toBeInTheDocument();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15 * 60_000);
  });
  expect(
    screen.getByRole("button", { name: "Refresh response" }),
  ).toBeEnabled();
  const boundedRefreshCount = refresh.mock.calls.length;
  expect(boundedRefreshCount).toBeGreaterThan(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15 * 60_000);
  });
  expect(refresh).toHaveBeenCalledTimes(boundedRefreshCount);

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Refresh response" }));
  });
  expect(refresh).toHaveBeenCalledTimes(boundedRefreshCount + 1);
  unmount();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });
  expect(refresh).toHaveBeenCalledTimes(boundedRefreshCount + 1);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("stopping a recovered attempt keeps recovery blocked until authoritative terminal content arrives", async () => {
  const user = userEvent.setup();
  vi.mocked(fetch).mockImplementation(async (url) =>
    String(url).endsWith("/stop")
      ? new Response(null, { status: 202 })
      : activeReplayResponse(),
  );
  let transcript = recoveringTranscript("streaming", "Checkpoint partial");
  render(<ComposerHarness onRefresh={() => transcript} />);

  await user.type(screen.getByLabelText("Message"), "Lost before started");
  vi.useFakeTimers();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
  });
  expect(screen.getByText("Checkpoint partial")).toBeVisible();
  expect(screen.getByLabelText("Message")).toBeDisabled();

  transcript = recoveringTranscript(
    "interrupted",
    "Checkpoint partial plus final flush",
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5_000);
  });
  expect(screen.getByText("Checkpoint partial plus final flush")).toBeVisible();
  expect(screen.getByLabelText("Message")).toBeEnabled();
  expect(fetch).toHaveBeenCalledWith(`/api/chat/attempts/${attemptId}/stop`, {
    method: "POST",
  });
  expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
});

test("ignores admitted stream events arriving after the composer unmounts", async () => {
  const user = userEvent.setup();
  const encoder = new TextEncoder();
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
  vi.mocked(fetch).mockResolvedValue(
    new Response(
      new ReadableStream({
        start(controller) {
          streamController = controller;
          controller.enqueue(
            encoder.encode(`{"type":"started","attemptId":"${attemptId}"}\n`),
          );
        },
      }),
    ),
  );
  const refresh = vi.fn();
  const changeMessages = vi.fn();
  const changeGenerating = vi.fn();
  const { unmount } = render(
    <ChatComposer
      conversationId="conversation-1"
      messages={[]}
      onMessagesChange={changeMessages}
      onGeneratingChange={changeGenerating}
      onAuthoritativeRefresh={refresh}
    />,
  );
  await user.type(screen.getByLabelText("Message"), "Lost before started");
  await user.click(screen.getByRole("button", { name: "Send" }));
  const generatingChanges = changeGenerating.mock.calls.length;
  const messageChanges = changeMessages.mock.calls.length;
  expect(messageChanges).toBe(1);
  unmount();
  await act(async () => {
    streamController?.enqueue(
      encoder.encode(
        `{"type":"delta","attemptId":"${attemptId}","text":"Too late"}\n{"type":"completed","attemptId":"${attemptId}","usage":{"inputTokens":1,"outputTokens":1,"estimated":false}}\n`,
      ),
    );
    streamController?.close();
  });
  expect(changeGenerating).toHaveBeenCalledTimes(generatingChanges);
  expect(changeMessages).toHaveBeenCalledTimes(messageChanges);
  expect(refresh).not.toHaveBeenCalled();
});

test.each([
  "network",
  "empty stream",
  "proxy error",
  "untyped error",
  "pre-start read",
] as const)(
  "retains the identical submission body through an ambiguous %s failure and refreshes terminal replay",
  async (failure) => {
    const user = userEvent.setup();
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("30000000-0000-4000-8000-000000000003")
      .mockReturnValueOnce("40000000-0000-4000-8000-000000000004");
    const bodies: string[] = [];
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      bodies.push(String(init?.body));
      if (bodies.length === 1) {
        if (failure === "network") {
          throw new TypeError("connection lost after admission");
        }
        if (failure === "untyped error") {
          return Response.json(
            { error: { message: "proxy failure" } },
            { status: 502 },
          );
        }
        if (failure === "pre-start read") {
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.error(new TypeError("lost first event"));
              },
            }),
          );
        }
        return failure === "empty stream"
          ? responseFromChunks([])
          : new Response("proxy unavailable", { status: 502 });
      }
      return responseFromChunks([
        `{"type":"completed","attemptId":"${attemptId}","usage":{"inputTokens":1,"outputTokens":1,"estimated":false}}\n`,
      ]);
    });
    render(
      <ComposerHarness
        refreshedMessages={[
          {
            id: "persisted-user",
            role: "user",
            kind: "user",
            content: "Keep my draft",
          },
          {
            id: "persisted-assistant",
            role: "assistant",
            kind: "generated",
            attemptId,
            status: "complete",
            content: "Authoritative reply",
            errorCode: null,
            retryable: false,
          },
        ]}
      />,
    );
    await user.type(screen.getByLabelText("Message"), "Keep my draft");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByLabelText("Message")).toBeEnabled());
    expect(screen.getByLabelText("Message")).toHaveValue("Keep my draft");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Authoritative reply")).toBeVisible();
    expect(screen.getAllByText("Keep my draft")).toHaveLength(1);
    expect(screen.getByLabelText("Message")).toHaveValue("");
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toBe(bodies[0]);
  },
);

test("a changed draft and an authoritatively rejected submission each receive a new idempotency key", async () => {
  const user = userEvent.setup();
  const keys = [
    "30000000-0000-4000-8000-000000000003",
    "40000000-0000-4000-8000-000000000004",
    "50000000-0000-4000-8000-000000000005",
  ] as const;
  let index = 0;
  vi.spyOn(crypto, "randomUUID").mockImplementation(() => keys[index++]!);
  const bodies: Array<{ clientRequestId: string; content: string }> = [];
  vi.mocked(fetch).mockImplementation(async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    if (bodies.length === 1) {
      throw new TypeError("network unavailable");
    }
    return Response.json(
      {
        error: {
          code: "CHAT_USER_REQUEST_QUOTA",
          message: "Quota reached",
          retryable: true,
        },
      },
      { status: 429 },
    );
  });

  render(<ComposerHarness />);
  await user.type(screen.getByLabelText("Message"), "Old draft");
  await user.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(screen.getByLabelText("Message")).toBeEnabled());
  await user.clear(screen.getByLabelText("Message"));
  await user.type(screen.getByLabelText("Message"), "Changed draft");
  await user.click(screen.getByRole("button", { name: "Send" }));
  expect(await screen.findByText("Quota reached")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(bodies).toHaveLength(3));
  expect(bodies.map((body) => body.clientRequestId)).toEqual(keys);
  expect(bodies.map((body) => body.content)).toEqual([
    "Old draft",
    "Changed draft",
    "Changed draft",
  ]);
});

test("an ambiguous manual retry retains its body and terminal replay refreshes the replacement bubble", async () => {
  const user = userEvent.setup();
  let key = 0;
  vi.spyOn(crypto, "randomUUID").mockImplementation(() =>
    key++ === 0
      ? "30000000-0000-4000-8000-000000000003"
      : "40000000-0000-4000-8000-000000000004",
  );
  const bodies: string[] = [];
  vi.mocked(fetch).mockImplementation(async (_url, init) => {
    bodies.push(String(init?.body));
    if (bodies.length === 1) {
      throw new TypeError("retry response lost");
    }
    return responseFromChunks([
      `{"type":"completed","attemptId":"${replacementAttemptId}","usage":{"inputTokens":1,"outputTokens":1,"estimated":false}}\n`,
    ]);
  });
  render(
    <ComposerHarness
      initialMessages={[
        {
          id: "assistant",
          role: "assistant",
          kind: "generated",
          attemptId,
          status: "interrupted",
          content: "Old partial",
          errorCode: "CHAT_STREAM_INTERRUPTED",
          retryable: true,
        },
      ]}
      refreshedMessages={[
        {
          id: "assistant",
          role: "assistant",
          kind: "generated",
          attemptId: replacementAttemptId,
          status: "complete",
          content: "Recovered authoritative reply",
          errorCode: null,
          retryable: false,
        },
      ]}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Unable to reach the chat service.",
  );
  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(
    await screen.findByText("Recovered authoritative reply"),
  ).toBeVisible();
  expect(screen.queryByText("Old partial")).not.toBeInTheDocument();
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toBe(bodies[0]);
  expect(JSON.parse(bodies[0]!)).toEqual({
    clientRequestId: "30000000-0000-4000-8000-000000000003",
    retryAttemptId: attemptId,
  });
});

test("changes send to stop, calls the stop endpoint before aborting, and preserves partial text", async () => {
  const user = userEvent.setup();
  let messageSignal: AbortSignal | undefined;
  let abortedWhenStopCalled = true;
  const encoder = new TextEncoder();

  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/messages")) {
      messageSignal = init?.signal as AbortSignal;
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                `{"type":"started","attemptId":"${attemptId}"}\n{"type":"delta","attemptId":"${attemptId}","text":"Keep this"}\n`,
              ),
            );
            messageSignal?.addEventListener(
              "abort",
              () => controller.error(new DOMException("Aborted", "AbortError")),
              { once: true },
            );
          },
        }),
      );
    }
    abortedWhenStopCalled = messageSignal?.aborted ?? true;
    return new Response(null, { status: 202 });
  });

  render(<ComposerHarness />);
  await user.type(screen.getByLabelText("Message"), "Hello");
  await user.click(screen.getByRole("button", { name: "Send" }));

  expect(await screen.findByText("Keep this")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Stop" }));

  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      `/api/chat/attempts/${attemptId}/stop`,
      expect.objectContaining({ method: "POST" }),
    ),
  );
  expect(abortedWhenStopCalled).toBe(false);
  expect(messageSignal?.aborted).toBe(true);
  expect(screen.getByText("Keep this")).toBeVisible();
  expect(screen.getByText("Stopped.")).toBeVisible();
});

test("keeps the authoritative stream active when stop returns an error and accepts its completion", async () => {
  const user = userEvent.setup();
  const encoder = new TextEncoder();
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
  let messageSignal: AbortSignal | undefined;

  vi.mocked(fetch).mockImplementation(async (input, init) => {
    if (String(input).endsWith("/messages")) {
      messageSignal = init?.signal as AbortSignal;
      return new Response(
        new ReadableStream({
          start(controller) {
            streamController = controller;
            controller.enqueue(
              encoder.encode(
                `{"type":"started","attemptId":"${attemptId}"}\n{"type":"delta","attemptId":"${attemptId}","text":"Almost done"}\n`,
              ),
            );
          },
        }),
      );
    }
    return Response.json(
      {
        error: {
          code: "CHAT_NOT_FOUND",
          message: "The requested chat was not found.",
          retryable: false,
        },
      },
      { status: 404 },
    );
  });

  render(<ComposerHarness />);
  await user.type(screen.getByLabelText("Message"), "Hello");
  await user.click(screen.getByRole("button", { name: "Send" }));

  expect(await screen.findByText("Almost done")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Stop" }));

  expect(
    await screen.findByText("The requested chat was not found."),
  ).toBeVisible();
  expect(messageSignal?.aborted).toBe(false);
  expect(screen.queryByText("Stopped.")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Message")).toBeDisabled();

  streamController?.enqueue(
    encoder.encode(
      `{"type":"completed","attemptId":"${attemptId}","usage":{"inputTokens":1,"outputTokens":2,"estimated":false}}\n`,
    ),
  );
  streamController?.close();

  await waitFor(() => expect(screen.getByLabelText("Message")).toBeEnabled());
  expect(screen.getByText("Almost done")).toBeVisible();
  expect(screen.queryByText("Stopped.")).not.toBeInTheDocument();
});

test("surfaces a network stop failure without aborting the active stream", async () => {
  const user = userEvent.setup();
  const encoder = new TextEncoder();
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
  let messageSignal: AbortSignal | undefined;

  vi.mocked(fetch).mockImplementation(async (input, init) => {
    if (String(input).endsWith("/messages")) {
      messageSignal = init?.signal as AbortSignal;
      return new Response(
        new ReadableStream({
          start(controller) {
            streamController = controller;
            controller.enqueue(
              encoder.encode(`{"type":"started","attemptId":"${attemptId}"}\n`),
            );
          },
        }),
      );
    }
    throw new TypeError("network unavailable");
  });

  render(<ComposerHarness />);
  await user.type(screen.getByLabelText("Message"), "Hello");
  await user.click(screen.getByRole("button", { name: "Send" }));
  await user.click(await screen.findByRole("button", { name: "Stop" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Unable to reach the chat service.",
  );
  expect(messageSignal?.aborted).toBe(false);
  expect(screen.getByLabelText("Message")).toBeDisabled();

  streamController?.enqueue(
    encoder.encode(
      `{"type":"completed","attemptId":"${attemptId}","usage":{"inputTokens":1,"outputTokens":1,"estimated":false}}\n`,
    ),
  );
  streamController?.close();

  await waitFor(() => expect(screen.getByLabelText("Message")).toBeEnabled());
});

test("keeps a server-loaded streaming attempt disabled and stoppable", async () => {
  const user = userEvent.setup();
  vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 202 }));
  const streaming: Extract<
    UserConversationDetail["messages"][number],
    { kind: "generated" }
  > = {
    id: "assistant-streaming",
    role: "assistant",
    kind: "generated",
    attemptId,
    status: "streaming",
    content: "Already in progress",
    errorCode: null,
    retryable: false,
  };

  render(<ComposerHarness initialMessages={[streaming]} />);

  expect(screen.getByLabelText("Message")).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Stop" }));

  expect(fetch).toHaveBeenCalledWith(`/api/chat/attempts/${attemptId}/stop`, {
    method: "POST",
  });
  expect(screen.getByText("Already in progress")).toBeVisible();
  expect(screen.getByText("Stopped.")).toBeVisible();
});

test("manual retry replaces the visible interrupted bubble", async () => {
  const user = userEvent.setup();
  const initialMessage: Extract<
    UserConversationDetail["messages"][number],
    { kind: "generated" }
  > = {
    id: "assistant-1",
    role: "assistant",
    kind: "generated",
    attemptId,
    status: "interrupted",
    content: "Old partial",
    errorCode: "CHAT_STREAM_INTERRUPTED",
    retryable: true,
  };
  vi.mocked(fetch).mockResolvedValue(
    responseFromChunks([
      `{"type":"started","attemptId":"${replacementAttemptId}"}\n`,
      `{"type":"delta","attemptId":"${replacementAttemptId}","text":"Fresh reply"}\n`,
      `{"type":"completed","attemptId":"${replacementAttemptId}","usage":{"inputTokens":1,"outputTokens":2,"estimated":false}}\n`,
    ]),
  );

  render(<ComposerHarness initialMessages={[initialMessage]} />);
  await user.click(screen.getByRole("button", { name: "Retry" }));

  expect(await screen.findByText("Fresh reply")).toBeVisible();
  expect(screen.queryByText("Old partial")).not.toBeInTheDocument();
  expect(fetch).toHaveBeenCalledWith(
    "/api/chat/conversations/conversation-1/messages",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        clientRequestId: "30000000-0000-4000-8000-000000000003",
        retryAttemptId: attemptId,
      }),
    }),
  );
});

test("links a generation-in-progress error to the owning conversation", async () => {
  const user = userEvent.setup();
  vi.mocked(fetch).mockResolvedValue(
    Response.json(
      {
        error: {
          code: "CHAT_GENERATION_IN_PROGRESS",
          message: "A response is already being generated for this chat.",
          retryable: true,
          metadata: { conversationId: "conversation-owner" },
        },
      },
      { status: 409 },
    ),
  );

  render(<ComposerHarness />);
  await user.type(screen.getByLabelText("Message"), "Hello");
  await user.click(screen.getByRole("button", { name: "Send" }));

  expect(
    await screen.findByRole("link", { name: "Open the active conversation" }),
  ).toHaveAttribute("href", "/app/conversations/conversation-owner");
  expect(screen.getByLabelText("Message")).toHaveValue("Hello");
  expect(screen.getByLabelText("Message")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
});

test("preserves the draft and re-enables the composer after a quota rejection", async () => {
  const user = userEvent.setup();
  vi.mocked(fetch).mockResolvedValue(
    Response.json(
      {
        error: {
          code: "CHAT_USER_REQUEST_QUOTA",
          message: "You have reached today's chat request limit.",
          retryable: false,
        },
      },
      { status: 429 },
    ),
  );

  render(<ComposerHarness />);
  await user.type(screen.getByLabelText("Message"), "Keep my draft");
  await user.click(screen.getByRole("button", { name: "Send" }));

  expect(
    await screen.findByText("You have reached today's chat request limit."),
  ).toBeVisible();
  expect(screen.getByLabelText("Message")).toHaveValue("Keep my draft");
  expect(screen.getByLabelText("Message")).toBeEnabled();
});

test("preserves the draft and re-enables the composer after a pre-start network failure", async () => {
  const user = userEvent.setup();
  vi.mocked(fetch).mockRejectedValue(new TypeError("network unavailable"));

  render(<ComposerHarness />);
  await user.type(screen.getByLabelText("Message"), "Keep my draft");
  await user.click(screen.getByRole("button", { name: "Send" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Unable to reach the chat service.",
  );
  expect(screen.getByLabelText("Message")).toHaveValue("Keep my draft");
  expect(screen.getByLabelText("Message")).toBeEnabled();
});

test("clears the draft only after a started event confirms admission", async () => {
  const user = userEvent.setup();
  const encoder = new TextEncoder();
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
  vi.mocked(fetch).mockResolvedValue(
    new Response(
      new ReadableStream({
        start(controller) {
          streamController = controller;
        },
      }),
    ),
  );

  render(<ComposerHarness />);
  await user.type(screen.getByLabelText("Message"), "Accepted draft");
  await user.click(screen.getByRole("button", { name: "Send" }));

  expect(screen.getByLabelText("Message")).toHaveValue("Accepted draft");
  expect(screen.getByLabelText("Message")).toBeDisabled();

  streamController?.enqueue(
    encoder.encode(
      `{"type":"started","attemptId":"${attemptId}"}\n{"type":"completed","attemptId":"${attemptId}","usage":{"inputTokens":1,"outputTokens":1,"estimated":false}}\n`,
    ),
  );
  streamController?.close();

  await waitFor(() => expect(screen.getByLabelText("Message")).toHaveValue(""));
});

test("returns to an enabled composer after completion in React strict mode", async () => {
  const user = userEvent.setup();
  vi.mocked(fetch).mockResolvedValue(
    responseFromChunks([
      `{"type":"started","attemptId":"${attemptId}"}\n`,
      `{"type":"completed","attemptId":"${attemptId}","usage":{"inputTokens":1,"outputTokens":1,"estimated":false}}\n`,
    ]),
  );

  render(
    <StrictMode>
      <ComposerHarness />
    </StrictMode>,
  );
  await user.type(screen.getByLabelText("Message"), "Hello");
  await user.click(screen.getByRole("button", { name: "Send" }));

  await waitFor(() => expect(screen.getByLabelText("Message")).toBeEnabled());
});
