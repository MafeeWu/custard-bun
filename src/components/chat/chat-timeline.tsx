"use client";

import { useEffect, useRef } from "react";
import { ChatMessage, type ChatClientMessage } from "./chat-message";
import { ChatMessageMotion, messageMotionKey } from "./chat-message-motion";

function authoritativeIdsFor(messages: ChatClientMessage[]) {
  return new Set(messages.map((message) => message.id));
}

export function ChatTimeline({
  messages,
  authoritativeMessageIds = authoritativeIdsFor(messages),
}: {
  messages: ChatClientMessage[];
  authoritativeMessageIds?: ReadonlySet<string>;
}) {
  const timelineRef = useRef<HTMLOListElement>(null);
  const latestMessage = messages.at(-1);
  const latestStatus =
    latestMessage && "status" in latestMessage
      ? latestMessage.status
      : undefined;

  useEffect(() => {
    const latest = timelineRef.current?.lastElementChild;
    if (
      latest instanceof HTMLElement &&
      typeof latest.scrollIntoView === "function"
    ) {
      latest.scrollIntoView({ block: "nearest" });
    }
  }, [latestMessage?.content, latestMessage?.id, latestStatus]);

  return (
    <ol
      ref={timelineRef}
      className="chat-timeline"
      aria-live="polite"
      aria-relevant="additions text"
    >
      {messages.map((message) => {
        const key = messageMotionKey(message);

        return (
          <ChatMessageMotion
            entering={!authoritativeMessageIds.has(message.id)}
            key={key}
            message={message}
          >
            <ChatMessage message={message} />
          </ChatMessageMotion>
        );
      })}
    </ol>
  );
}
