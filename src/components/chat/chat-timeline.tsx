"use client";

import { ChatMessage, type ChatClientMessage } from "./chat-message";
import { ChatMessageMotion, messageMotionKey } from "./chat-message-motion";

function entersFromClientInsert(message: ChatClientMessage) {
  return message.id.startsWith("user-") || message.id.startsWith("attempt-");
}

export function ChatTimeline({ messages }: { messages: ChatClientMessage[] }) {
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
            entering={entersFromClientInsert(message)}
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
