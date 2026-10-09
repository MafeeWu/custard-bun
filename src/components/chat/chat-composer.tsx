"use client";

import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from "react";
import type { PublicChatError } from "@/server/chat/chat-errors";
import type { ChatStreamEvent } from "@/server/chat/chat-events";
import type { ChatClientMessage } from "./chat-message";

export type { ChatClientMessage } from "./chat-message";

type TerminalEvent = "completed" | "failed" | "interrupted";

export async function consumeChatEventStream(
  response: Response,
  onEvent: (event: ChatStreamEvent) => void,
): Promise<{ attemptId?: string; terminal?: TerminalEvent }> {
  if (!response.body) {
    throw new Error("The response stream is unavailable.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let attemptId: string | undefined;
  let terminal: TerminalEvent | undefined;

  function applyLine(line: string) {
    if (!line.trim()) {
      return;
    }
    const event = JSON.parse(line) as ChatStreamEvent;
    attemptId = event.attemptId;
    if (
      event.type === "completed" ||
      event.type === "failed" ||
      event.type === "interrupted"
    ) {
      terminal = event.type;
    }
    onEvent(event);
  }

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      applyLine(line);
    }
    if (done) {
      break;
    }
  }
  applyLine(buffer);

  return { attemptId, terminal };
}

async function responseError(response: Response): Promise<PublicChatError> {
  try {
    const value = (await response.json()) as { error?: PublicChatError };
    if (value.error?.message) {
      return value.error;
    }
  } catch {
    // Use the stable fallback below.
  }
  return {
    code: "CHAT_INTERNAL",
    message: "Something went wrong while generating a response.",
    retryable: false,
  };
}

function generatedMessage(
  attemptId: string,
): Extract<ChatClientMessage, { kind: "generated" }> {
  return {
    id: `attempt-${attemptId}`,
    role: "assistant",
    kind: "generated",
    attemptId,
    status: "pending",
    content: "",
    errorCode: null,
    retryable: false,
  };
}

function activeAttemptFrom(messages: ChatClientMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message.kind === "generated" &&
      (message.status === "pending" || message.status === "streaming")
    ) {
      return message.attemptId;
    }
  }
  return undefined;
}

export function ChatComposer({
  conversationId,
  messages,
  onMessagesChange,
  onGeneratingChange,
}: {
  conversationId: string;
  messages: ChatClientMessage[];
  onMessagesChange: Dispatch<SetStateAction<ChatClientMessage[]>>;
  onGeneratingChange?: (generating: boolean) => void;
}) {
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [activeAttemptId, setActiveAttemptId] = useState<string | undefined>(
    () => activeAttemptFrom(messages),
  );
  const [error, setError] = useState<PublicChatError>();
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const stoppingRef = useRef(false);
  const mountedRef = useRef(true);
  const generating = submitting || Boolean(activeAttemptId);

  useEffect(() => {
    onGeneratingChange?.(generating);
  }, [generating, onGeneratingChange]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
    };
  }, []);

  function updateAttempt(
    attemptId: string,
    update: (
      message: Extract<ChatClientMessage, { kind: "generated" }>,
    ) => Extract<ChatClientMessage, { kind: "generated" }>,
  ) {
    onMessagesChange((current) =>
      current.map((message) =>
        message.kind === "generated" && message.attemptId === attemptId
          ? update(message)
          : message,
      ),
    );
  }

  async function generate(input: {
    content?: string;
    retryAttemptId?: string;
  }) {
    const clientRequestId = crypto.randomUUID();
    const controller = new AbortController();
    controllerRef.current = controller;
    stoppingRef.current = false;
    setSubmitting(true);
    setError(undefined);
    let currentAttemptId: string | undefined;

    try {
      const response = await fetch(
        `/api/chat/conversations/${conversationId}/messages`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            clientRequestId,
            ...(input.retryAttemptId
              ? { retryAttemptId: input.retryAttemptId }
              : { content: input.content }),
          }),
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        setError(await responseError(response));
        return;
      }

      const result = await consumeChatEventStream(response, (event) => {
        currentAttemptId = event.attemptId;
        if (event.type === "started") {
          setActiveAttemptId(event.attemptId);
          onMessagesChange((current) => {
            const assistant = generatedMessage(event.attemptId);
            if (input.retryAttemptId) {
              return current.map((message) =>
                message.kind === "generated" &&
                message.attemptId === input.retryAttemptId
                  ? assistant
                  : message,
              );
            }
            return [
              ...current,
              {
                id: `user-${clientRequestId}`,
                role: "user",
                kind: "user",
                content: input.content ?? "",
              },
              assistant,
            ];
          });
          return;
        }
        if (event.type === "delta") {
          updateAttempt(event.attemptId, (message) => ({
            ...message,
            status: "streaming",
            content: `${message.content}${event.text}`,
          }));
          return;
        }
        if (event.type === "completed") {
          updateAttempt(event.attemptId, (message) => ({
            ...message,
            status: "complete",
            errorCode: null,
            retryable: false,
            statusMessage: undefined,
          }));
          setActiveAttemptId(undefined);
          return;
        }
        updateAttempt(event.attemptId, (message) => ({
          ...message,
          status: event.type,
          errorCode: event.code,
          retryable: event.retryable,
          statusMessage: event.message,
        }));
        setActiveAttemptId(undefined);
      });

      if (result.attemptId && !result.terminal) {
        updateAttempt(result.attemptId, (message) => ({
          ...message,
          status: "interrupted",
          errorCode: "CHAT_STREAM_INTERRUPTED",
          retryable: true,
          statusMessage: "The response stream ended before completion.",
        }));
      }
    } catch {
      if (!stoppingRef.current && !controller.signal.aborted) {
        if (currentAttemptId) {
          updateAttempt(currentAttemptId, (message) => ({
            ...message,
            status: "interrupted",
            errorCode: "CHAT_STREAM_INTERRUPTED",
            retryable: true,
            statusMessage: "The response stream ended before completion.",
          }));
        } else {
          setError({
            code: "CHAT_INTERNAL",
            message: "Unable to reach the chat service.",
            retryable: true,
          });
        }
      }
    } finally {
      if (mountedRef.current) {
        setSubmitting(false);
        setActiveAttemptId(undefined);
      }
      if (controllerRef.current === controller) {
        controllerRef.current = undefined;
      }
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = content.trim();
    if (!normalized || generating) {
      return;
    }
    setContent("");
    await generate({ content: normalized });
  }

  async function stop() {
    const attemptId = activeAttemptId;
    const controller = controllerRef.current;
    if (!attemptId) {
      return;
    }
    stoppingRef.current = true;
    try {
      const response = await fetch(`/api/chat/attempts/${attemptId}/stop`, {
        method: "POST",
      });
      if (!response.ok) {
        setError(await responseError(response));
      }
    } finally {
      updateAttempt(attemptId, (message) => ({
        ...message,
        status: "interrupted",
        errorCode: "CHAT_STREAM_INTERRUPTED",
        retryable: true,
        statusMessage: "Stopped.",
      }));
      controller?.abort();
      setActiveAttemptId(undefined);
    }
  }

  const retryable = messages.filter(
    (
      message,
    ): message is Extract<ChatClientMessage, { kind: "generated" }> =>
      message.kind === "generated" &&
      message.retryable &&
      (message.status === "failed" || message.status === "interrupted"),
  );

  return (
    <div className="chat-composer-shell">
      {retryable.map((message) => (
        <button
          className="brand-link chat-retry"
          disabled={generating}
          key={message.attemptId}
          onClick={() => void generate({ retryAttemptId: message.attemptId })}
          type="button"
        >
          Retry
        </button>
      ))}
      <form className="chat-composer" onSubmit={submit}>
        <label className="sr-only" htmlFor="chat-message">
          Message
        </label>
        <textarea
          id="chat-message"
          name="message"
          placeholder="Write a message"
          value={content}
          disabled={generating}
          onChange={(event) => setContent(event.target.value)}
          rows={3}
        />
        {activeAttemptId ? (
          <button onClick={() => void stop()} type="button">
            Stop
          </button>
        ) : (
          <button disabled={generating || !content.trim()} type="submit">
            Send
          </button>
        )}
      </form>
      {error ? (
        <div className="chat-error" role="alert">
          <p>{error.message}</p>
          {error.code === "CHAT_GENERATION_IN_PROGRESS" &&
          typeof error.metadata?.conversationId === "string" ? (
            <Link
              className="brand-link"
              href={`/app/conversations/${error.metadata.conversationId}`}
            >
              Open the active conversation
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
