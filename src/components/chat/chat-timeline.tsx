"use client";

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
  return (
    <ol
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
