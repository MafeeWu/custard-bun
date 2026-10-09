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

async function responseError(
  response: Response,
): Promise<PublicChatError | undefined> {
  try {
    const value = (await response.json()) as { error?: PublicChatError };
    if (
      typeof value.error?.message === "string" &&
      typeof value.error.code === "string" &&
      value.error.code.startsWith("CHAT_") &&
      typeof value.error.retryable === "boolean"
    ) {
      return value.error;
    }
  } catch {
    // Use the stable fallback below.
  }
  return undefined;
}

const transportError: PublicChatError = {
  code: "CHAT_INTERNAL",
  message: "Unable to reach the chat service.",
  retryable: true,
};

interface PendingSubmission {
  content?: string;
  retryAttemptId?: string;
  clientRequestId: string;
  body: string;
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
  onAuthoritativeRefresh,
}: {
  conversationId: string;
  messages: ChatClientMessage[];
  onMessagesChange: Dispatch<SetStateAction<ChatClientMessage[]>>;
  onGeneratingChange?: (generating: boolean) => void;
  onAuthoritativeRefresh?: () => void;
}) {
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [activeStreamAttemptId, setActiveAttemptId] = useState<string>();
  const activeAttemptId = activeStreamAttemptId ?? activeAttemptFrom(messages);
  const [generationOwnerConversationId, setGenerationOwnerConversationId] =
    useState<string>();
  const [error, setError] = useState<PublicChatError>();
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const stoppingRef = useRef(false);
  const mountedRef = useRef(true);
  const pendingSubmissionRef = useRef<PendingSubmission | undefined>(undefined);
  const generating =
    submitting ||
    Boolean(activeAttemptId) ||
    generationOwnerConversationId !== undefined;

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
    const pending = pendingSubmissionRef.current;
    const clientRequestId =
      pending &&
      pending.content === input.content &&
      pending.retryAttemptId === input.retryAttemptId
        ? pending.clientRequestId
        : crypto.randomUUID();
    const submission: PendingSubmission =
      pending?.clientRequestId === clientRequestId
        ? pending
        : {
            ...input,
            clientRequestId,
            body: JSON.stringify({ clientRequestId, ...input }),
          };
    pendingSubmissionRef.current = submission;
    const controller = new AbortController();
    controllerRef.current = controller;
    stoppingRef.current = false;
    setSubmitting(true);
    setError(undefined);
    let currentAttemptId: string | undefined;
    let started = false;

    try {
      const response = await fetch(
        `/api/chat/conversations/${conversationId}/messages`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: submission.body,
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        const nextError = await responseError(response);
        if (nextError && nextError.code !== "CHAT_INTERNAL") {
          pendingSubmissionRef.current = undefined;
        }
        setError(nextError ?? transportError);
        if (
          nextError?.code === "CHAT_GENERATION_IN_PROGRESS" &&
          typeof nextError.metadata?.conversationId === "string"
        ) {
          setGenerationOwnerConversationId(nextError.metadata.conversationId);
        }
        return;
      }

      const result = await consumeChatEventStream(response, (event) => {
        currentAttemptId = event.attemptId;
        if (event.type === "started") {
          started = true;
          pendingSubmissionRef.current = undefined;
          if (input.content !== undefined) {
            setContent("");
          }
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
        pendingSubmissionRef.current = undefined;
        if (!started) {
          if (input.content !== undefined) {
            setContent("");
          }
          setActiveAttemptId(undefined);
          onAuthoritativeRefresh?.();
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
      } else if (!result.attemptId) {
        setError(transportError);
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
      if (response.status !== 202) {
        setError((await responseError(response)) ?? transportError);
        stoppingRef.current = false;
        return;
      }
      updateAttempt(attemptId, (message) => ({
        ...message,
        status: "interrupted",
        errorCode: "CHAT_STREAM_INTERRUPTED",
        retryable: true,
        statusMessage: "Stopped.",
      }));
      controller?.abort();
      setActiveAttemptId(undefined);
    } catch {
      stoppingRef.current = false;
      setError({
        code: "CHAT_INTERNAL",
        message: "Unable to reach the chat service.",
        retryable: true,
      });
    }
  }

  const retryable = messages.filter(
    (message): message is Extract<ChatClientMessage, { kind: "generated" }> =>
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
          onChange={(event) => {
            if (
              pendingSubmissionRef.current?.content !==
              event.target.value.trim()
            ) {
              pendingSubmissionRef.current = undefined;
            }
            setContent(event.target.value);
          }}
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
