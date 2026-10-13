"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
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
  const timelineEndRef = useRef<HTMLSpanElement>(null);
  const shouldAutoFollowRef = useRef(true);
  const latestMessage = messages.at(-1);
  const latestStatus =
    latestMessage && "status" in latestMessage
      ? latestMessage.status
      : undefined;

  useEffect(() => {
    const updateAutoFollow = () => {
      const timelineEnd = timelineEndRef.current;
      if (!timelineEnd) return;
      const composer = timelineEnd
        .closest(".chat-conversation")
        ?.querySelector<HTMLElement>(".chat-composer-shell");
      const visibleBottom =
        composer?.getBoundingClientRect().top ?? window.innerHeight;
      const markerBottom = timelineEnd.getBoundingClientRect().bottom;
      shouldAutoFollowRef.current =
        markerBottom >= 0 && markerBottom <= visibleBottom + 96;
    };
    document.addEventListener("scroll", updateAutoFollow, { passive: true });
    return () => document.removeEventListener("scroll", updateAutoFollow);
  }, []);

  useLayoutEffect(() => {
    const timelineEnd = timelineEndRef.current;
    if (
      shouldAutoFollowRef.current &&
      timelineEnd &&
      typeof timelineEnd.scrollIntoView === "function"
    ) {
      timelineEnd.scrollIntoView({ block: "end" });
      const composer = timelineEnd
        .closest(".chat-conversation")
        ?.querySelector<HTMLElement>(".chat-composer-shell");
      if (composer) {
        const overlap =
          timelineEnd.getBoundingClientRect().bottom -
          composer.getBoundingClientRect().top;
        if (overlap > 0) window.scrollBy(0, overlap);
      }
    }
  }, [latestMessage?.content, latestMessage?.id, latestStatus]);

  return (
    <ol
      className="chat-timeline"
      aria-live="polite"
      aria-relevant="additions text"
    >
      {messages.map((message, index) => {
        const key = messageMotionKey(message);

        return (
          <ChatMessageMotion
            entering={!authoritativeMessageIds.has(message.id)}
            key={key}
            message={message}
          >
            <ChatMessage message={message} />
            {index === messages.length - 1 ? (
              <span
                ref={timelineEndRef}
                aria-hidden="true"
                className="chat-timeline__end"
              />
            ) : null}
          </ChatMessageMotion>
        );
      })}
    </ol>
  );
}
