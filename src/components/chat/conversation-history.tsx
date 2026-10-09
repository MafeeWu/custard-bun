import Link from "next/link";
import type { ArchivedConversationSummary } from "@/server/chat/conversation-queries";

const dateFormatter = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
});

export function ConversationHistory({
  conversations,
}: {
  conversations: ArchivedConversationSummary[];
}) {
  return (
    <details className="chat-disclosure">
      <summary role="button">History</summary>
      <div className="chat-history">
        <h2>Conversation history</h2>
        {conversations.length ? (
          <ul>
            {conversations.map((conversation) => (
              <li key={conversation.id}>
                <Link href={`/app/conversations/${conversation.id}`}>
                  {conversation.character.displayName}
                  <span>{dateFormatter.format(conversation.archivedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p>No archived conversations yet.</p>
        )}
      </div>
    </details>
  );
}
