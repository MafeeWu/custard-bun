import type { UserConversationDetail } from "@/server/chat/conversation-queries";
import { getPublicChatErrorMessage } from "@/server/chat/chat-errors";
import { SafeMarkdown } from "./safe-markdown";

type ServerMessage = UserConversationDetail["messages"][number];
type GeneratedMessage = Extract<ServerMessage, { kind: "generated" }>;

export type ChatClientMessage =
  | Exclude<ServerMessage, { kind: "generated" }>
  | (GeneratedMessage & { statusMessage?: string });

function generatedStatus(
  message: Extract<ChatClientMessage, { kind: "generated" }>,
) {
  if (message.statusMessage) {
    return message.statusMessage;
  }
  if (message.status === "pending") {
    return "Waiting for a reply…";
  }
  if (message.errorCode) {
    return getPublicChatErrorMessage(message.errorCode);
  }
  if (message.status === "interrupted") {
    return "The response stream ended before completion.";
  }
  if (message.status === "failed") {
    return "Unable to generate a reply.";
  }
  return undefined;
}

export function ChatMessage({ message }: { message: ChatClientMessage }) {
  const assistant = message.role === "assistant";
  const status =
    message.kind === "generated" ? generatedStatus(message) : undefined;

  return (
    <article
      aria-label={assistant ? "Character message" : "Your message"}
      className="chat-message__bubble"
    >
      <p className="chat-message-author">{assistant ? "Character" : "You"}</p>
      {message.content ? (
        assistant ? (
          <SafeMarkdown>{message.content}</SafeMarkdown>
        ) : (
          <p>{message.content}</p>
        )
      ) : null}
      {status ? (
        <p
          className="chat-message-status"
          role={
            message.kind === "generated" && message.status === "failed"
              ? "alert"
              : "status"
          }
        >
          {status}
        </p>
      ) : null}
    </article>
  );
}
