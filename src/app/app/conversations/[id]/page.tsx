import { headers } from "next/headers";
import { notFound } from "next/navigation";
import {
  deleteConversationAction,
  restartConversationAction,
} from "@/app/app/conversations/actions";
import { ChatScreen } from "@/components/chat/chat-screen";
import { requireSession } from "@/server/auth/require-session";
import {
  getConversationForUser,
  listActiveConversations,
  listArchivedCharacterConversations,
} from "@/server/chat/conversation-queries";
import { getDatabase } from "@/server/db/database";
import { renderFocusedChatRouteShell } from "../../route-shell";

export const dynamic = "force-dynamic";

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, session, database] = await Promise.all([
    params,
    requireSession(await headers()),
    getDatabase(),
  ]);
  const conversation = await getConversationForUser(database, {
    userId: session.user.id,
    conversationId: id,
  });
  if (!conversation) {
    notFound();
  }

  const [archivedConversations, activeConversations] = await Promise.all([
    listArchivedCharacterConversations(database, {
      userId: session.user.id,
      characterId: conversation.character.id,
    }),
    listActiveConversations(database, session.user.id),
  ]);
  const activeConversationId = activeConversations.find(
    (candidate) => candidate.character.id === conversation.character.id,
  )?.id;

  return renderFocusedChatRouteShell(
    <ChatScreen
      activeConversationId={
        activeConversationId === conversation.id
          ? undefined
          : activeConversationId
      }
      archivedConversations={archivedConversations}
      conversation={conversation}
      deleteAction={deleteConversationAction.bind(null, conversation.id)}
      restartAction={restartConversationAction.bind(
        null,
        conversation.id,
        conversation.character.slug,
      )}
    />,
  );
}
