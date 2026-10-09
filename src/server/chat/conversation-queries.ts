import { and, desc, eq, isNotNull } from "drizzle-orm";
import type { ChatErrorCode } from "@/server/chat/chat-errors";
import type { Database } from "@/server/db/client";
import {
  conversation,
  conversationMessage,
  generationAttempt,
  type GenerationStatus,
} from "@/server/db/chat-schema";
import { character, characterVersion } from "@/server/db/character-schema";

export interface ConversationCharacterSummary {
  id: string;
  slug: string;
  displayName: string;
  avatarPath: string;
  pinnedVersionId: string;
  isCurrentDefault: boolean;
}

export interface ActiveConversationSummary {
  id: string;
  character: ConversationCharacterSummary;
  lastMessageAt: Date;
}

export interface ArchivedConversationSummary {
  id: string;
  character: ConversationCharacterSummary;
  archivedAt: Date;
  lastMessageAt: Date;
}

export interface UserConversationDetail {
  id: string;
  lifecycle: "active" | "archived";
  character: ConversationCharacterSummary;
  messages: Array<
    | { id: string; role: "user"; kind: "user"; content: string }
    | {
        id: string;
        role: "assistant";
        kind: "opening";
        content: string;
      }
    | {
        id: string;
        role: "assistant";
        kind: "generated";
        attemptId: string;
        status: GenerationStatus;
        content: string;
        errorCode: ChatErrorCode | null;
        retryable: boolean;
      }
  >;
}

function characterSummary(row: {
  characterId: string;
  slug: string;
  displayName: string;
  avatarPath: string;
  pinnedVersionId: string;
  defaultVersionId: string | null;
}): ConversationCharacterSummary {
  return {
    id: row.characterId,
    slug: row.slug,
    displayName: row.displayName,
    avatarPath: row.avatarPath,
    pinnedVersionId: row.pinnedVersionId,
    isCurrentDefault: row.defaultVersionId === row.pinnedVersionId,
  };
}

const conversationProjection = {
  id: conversation.id,
  lifecycle: conversation.lifecycle,
  characterId: character.id,
  slug: character.slug,
  displayName: characterVersion.displayName,
  avatarPath: characterVersion.avatarPath,
  pinnedVersionId: characterVersion.id,
  defaultVersionId: character.defaultVersionId,
};

export async function getConversationForUser(
  database: Database,
  input: { userId: string; conversationId: string },
): Promise<UserConversationDetail | null> {
  const [selectedConversation] = await database
    .select(conversationProjection)
    .from(conversation)
    .innerJoin(character, eq(character.id, conversation.characterId))
    .innerJoin(
      characterVersion,
      and(
        eq(characterVersion.id, conversation.characterVersionId),
        eq(characterVersion.characterId, conversation.characterId),
      ),
    )
    .where(
      and(
        eq(conversation.id, input.conversationId),
        eq(conversation.userId, input.userId),
      ),
    )
    .limit(1);

  if (!selectedConversation) {
    return null;
  }

  const rows = await database
    .select({
      id: conversationMessage.id,
      sequence: conversationMessage.sequence,
      role: conversationMessage.role,
      kind: conversationMessage.kind,
      messageContent: conversationMessage.content,
      attemptId: generationAttempt.id,
      status: generationAttempt.status,
      attemptContent: generationAttempt.content,
      errorCode: generationAttempt.errorCategory,
      retryable: generationAttempt.retryable,
    })
    .from(conversationMessage)
    .innerJoin(
      conversation,
      and(
        eq(conversation.id, conversationMessage.conversationId),
        eq(conversation.userId, input.userId),
      ),
    )
    .leftJoin(
      generationAttempt,
      and(
        eq(generationAttempt.assistantMessageId, conversationMessage.id),
        eq(generationAttempt.isCurrent, true),
      ),
    )
    .where(eq(conversation.id, input.conversationId))
    .orderBy(conversationMessage.sequence);

  const messages: UserConversationDetail["messages"] = [];
  for (const row of rows) {
    if (
      row.kind === "user" &&
      row.role === "user" &&
      row.messageContent !== null
    ) {
      messages.push({
        id: row.id,
        role: "user",
        kind: "user",
        content: row.messageContent,
      });
    } else if (
      row.kind === "opening" &&
      row.role === "assistant" &&
      row.messageContent !== null
    ) {
      messages.push({
        id: row.id,
        role: "assistant",
        kind: "opening",
        content: row.messageContent,
      });
    } else if (
      row.kind === "generated" &&
      row.role === "assistant" &&
      row.attemptId !== null &&
      row.status !== null &&
      row.attemptContent !== null
    ) {
      messages.push({
        id: row.id,
        role: "assistant",
        kind: "generated",
        attemptId: row.attemptId,
        status: row.status,
        content: row.attemptContent,
        errorCode: row.errorCode as ChatErrorCode | null,
        retryable: row.retryable ?? false,
      });
    }
  }

  return {
    id: selectedConversation.id,
    lifecycle: selectedConversation.lifecycle,
    character: characterSummary(selectedConversation),
    messages,
  };
}

export async function listActiveConversations(
  database: Database,
  userId: string,
): Promise<ActiveConversationSummary[]> {
  const rows = await database
    .select({
      ...conversationProjection,
      lastMessageAt: conversation.lastMessageAt,
    })
    .from(conversation)
    .innerJoin(character, eq(character.id, conversation.characterId))
    .innerJoin(
      characterVersion,
      and(
        eq(characterVersion.id, conversation.characterVersionId),
        eq(characterVersion.characterId, conversation.characterId),
      ),
    )
    .where(
      and(
        eq(conversation.userId, userId),
        eq(conversation.lifecycle, "active"),
      ),
    )
    .orderBy(desc(conversation.lastMessageAt), desc(conversation.id));

  return rows.map((row) => ({
    id: row.id,
    character: characterSummary(row),
    lastMessageAt: row.lastMessageAt,
  }));
}

export async function listArchivedCharacterConversations(
  database: Database,
  input: { userId: string; characterId: string },
): Promise<ArchivedConversationSummary[]> {
  const rows = await database
    .select({
      ...conversationProjection,
      archivedAt: conversation.archivedAt,
      lastMessageAt: conversation.lastMessageAt,
    })
    .from(conversation)
    .innerJoin(character, eq(character.id, conversation.characterId))
    .innerJoin(
      characterVersion,
      and(
        eq(characterVersion.id, conversation.characterVersionId),
        eq(characterVersion.characterId, conversation.characterId),
      ),
    )
    .where(
      and(
        eq(conversation.userId, input.userId),
        eq(conversation.characterId, input.characterId),
        eq(conversation.lifecycle, "archived"),
        isNotNull(conversation.archivedAt),
      ),
    )
    .orderBy(desc(conversation.archivedAt), desc(conversation.id));

  return rows.map((row) => ({
    id: row.id,
    character: characterSummary(row),
    archivedAt: row.archivedAt as Date,
    lastMessageAt: row.lastMessageAt,
  }));
}
