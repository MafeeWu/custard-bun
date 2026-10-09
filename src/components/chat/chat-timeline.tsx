import { ChatMessage, type ChatClientMessage } from "./chat-message";

export function ChatTimeline({
  messages,
}: {
  messages: ChatClientMessage[];
}) {
  return (
    <ol className="chat-timeline" aria-live="polite" aria-relevant="additions text">
      {messages.map((message) => (
        <ChatMessage key={message.id} message={message} />
      ))}
    </ol>
  );
}
