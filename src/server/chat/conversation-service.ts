import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import {
  character,
  characterVersion,
} from "@/server/db/character-schema";
import {
  conversation,
  conversationMessage,
  generationAttempt,
  generationLease,
} from "@/server/db/chat-schema";
import { ChatDomainError } from "./chat-errors";
import {
  lockUserCharacterChatMutation,
  lockUserChatMutation,
  type ChatTransaction,
} from "./chat-locks";

export interface ConversationService {
  openOrCreate(input: {
    userId: string;
    characterId: string;
  }): Promise<{ conversationId: string; created: boolean }>;
  restart(input: {
    userId: string;
    conversationId: string;
  }): Promise<{ conversationId: string }>;
  delete(input: {
    userId: string;
    conversationId: string;
  }): Promise<void>;
}

function notFound(): ChatDomainError {
  return new ChatDomainError(
    "CHAT_NOT_FOUND",
    "The requested conversation was not found.",
  );
}

function readOnly(): ChatDomainError {
  return new ChatDomainError(
    "CHAT_READ_ONLY",
    "This conversation cannot be changed.",
  );
}

function generationInProgress(): ChatDomainError {
  return new ChatDomainError(
    "CHAT_GENERATION_IN_PROGRESS",
    "Stop the current reply before changing this conversation.",
    { retryable: true },
  );
}

async function findActiveConversation(
  transaction: ChatTransaction,
  input: { userId: string; characterId: string },
) {
  const [row] = await transaction
    .select({ id: conversation.id })
    .from(conversation)
    .where(
      and(
        eq(conversation.userId, input.userId),
        eq(conversation.characterId, input.characterId),
        eq(conversation.lifecycle, "active"),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function requireMutableConversation(
  transaction: ChatTransaction,
  input: { userId: string; conversationId: string },
) {
  const [row] = await transaction
    .select({
      id: conversation.id,
      characterId: conversation.characterId,
      lifecycle: conversation.lifecycle,
    })
    .from(conversation)
    .where(
      and(
        eq(conversation.id, input.conversationId),
        eq(conversation.userId, input.userId),
      ),
    )
    .for("update")
    .limit(1);

  if (!row) {
    throw notFound();
  }
  if (row.lifecycle === "archived") {
    throw readOnly();
  }
  return row;
}

async function hasGenerationLease(
  transaction: ChatTransaction,
  input: { userId: string; conversationId: string },
): Promise<boolean> {
  const [lease] = await transaction
    .select({ attemptId: generationLease.attemptId })
    .from(generationLease)
    .innerJoin(
      generationAttempt,
      eq(generationAttempt.id, generationLease.attemptId),
    )
    .innerJoin(
      conversationMessage,
      eq(conversationMessage.id, generationAttempt.assistantMessageId),
    )
    .innerJoin(
      conversation,
      eq(conversation.id, conversationMessage.conversationId),
    )
    .where(
      and(
        eq(conversationMessage.conversationId, input.conversationId),
        eq(conversation.userId, input.userId),
      ),
    )
    .limit(1);
  return Boolean(lease);
}

async function insertConversationWithOpening(
  transaction: ChatTransaction,
  input: {
    userId: string;
    characterId: string;
    characterVersionId: string;
    openingMessage: string;
  },
): Promise<string> {
  const conversationId = randomUUID();
  const now = new Date();
  await transaction.insert(conversation).values({
    id: conversationId,
    userId: input.userId,
    characterId: input.characterId,
    characterVersionId: input.characterVersionId,
    createdAt: now,
    updatedAt: now,
    lastMessageAt: now,
  });
  await transaction.insert(conversationMessage).values({
    id: randomUUID(),
    conversationId,
    sequence: 1,
    role: "assistant",
    kind: "opening",
    content: input.openingMessage,
    createdAt: now,
  });
  return conversationId;
}

function errorDetails(error: unknown): { code?: string; message: string } {
  if (!error || typeof error !== "object") {
    return { message: String(error) };
  }
  const candidate = error as {
    code?: unknown;
    message?: unknown;
    cause?: unknown;
  };
  const nested = candidate.cause ? errorDetails(candidate.cause) : null;
  return {
    code:
      typeof candidate.code === "string"
        ? candidate.code
        : nested?.code,
    message: [
      typeof candidate.message === "string" ? candidate.message : "",
      nested?.message ?? "",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

function isUniqueActiveRace(error: unknown): boolean {
  const details = errorDetails(error);
  return (
    details.code === "23505" ||
    /one active conversation|conversations_one_active_conversation_idx/i.test(
      details.message,
    )
  );
}

async function resolveMutableDefault(
  transaction: ChatTransaction,
  characterId: string,
) {
  const [selectedCharacter] = await transaction
    .select({
      lifecycle: character.lifecycle,
      defaultVersionId: character.defaultVersionId,
    })
    .from(character)
    .where(eq(character.id, characterId))
    .for("update")
    .limit(1);

  if (!selectedCharacter) {
    throw notFound();
  }
  if (
    selectedCharacter.lifecycle !== "active" ||
    !selectedCharacter.defaultVersionId
  ) {
    throw readOnly();
  }

  const [resolved] = await transaction
    .select({
      id: characterVersion.id,
      openingMessage: characterVersion.openingMessage,
    })
    .from(characterVersion)
    .where(
      and(
        eq(characterVersion.id, selectedCharacter.defaultVersionId),
        eq(characterVersion.characterId, characterId),
      ),
    )
    .limit(1);
  if (!resolved) {
    throw readOnly();
  }
  return resolved;
}

export function createConversationService(
  database: Database,
): ConversationService {
  return {
    async openOrCreate(input) {
      return database.transaction(async (transaction) => {
        await lockUserChatMutation(transaction, input.userId);
        await lockUserCharacterChatMutation(
          transaction,
          input.userId,
          input.characterId,
        );

        const existing = await findActiveConversation(transaction, input);
        if (existing) {
          return { conversationId: existing.id, created: false };
        }

        const pinnedVersion = await resolveMutableDefault(
          transaction,
          input.characterId,
        );

        try {
          const conversationId = await transaction.transaction(
            async (savepoint) =>
              insertConversationWithOpening(savepoint, {
                userId: input.userId,
                characterId: input.characterId,
                characterVersionId: pinnedVersion.id,
                openingMessage: pinnedVersion.openingMessage,
              }),
          );
          return { conversationId, created: true };
        } catch (error) {
          if (!isUniqueActiveRace(error)) {
            throw error;
          }
          const winner = await findActiveConversation(transaction, input);
          if (!winner) {
            throw error;
          }
          return { conversationId: winner.id, created: false };
        }
      });
    },

    async restart(input) {
      return database.transaction(async (transaction) => {
        await lockUserChatMutation(transaction, input.userId);

        const [candidate] = await transaction
          .select({
            characterId: conversation.characterId,
            lifecycle: conversation.lifecycle,
          })
          .from(conversation)
          .where(
            and(
              eq(conversation.id, input.conversationId),
              eq(conversation.userId, input.userId),
            ),
          )
          .limit(1);
        if (!candidate) {
          throw notFound();
        }
        if (candidate.lifecycle === "archived") {
          throw readOnly();
        }

        await lockUserCharacterChatMutation(
          transaction,
          input.userId,
          candidate.characterId,
        );
        const current = await requireMutableConversation(transaction, input);
        if (
          await hasGenerationLease(transaction, {
            userId: input.userId,
            conversationId: current.id,
          })
        ) {
          throw generationInProgress();
        }

        const pinnedVersion = await resolveMutableDefault(
          transaction,
          current.characterId,
        );
        const now = new Date();
        await transaction
          .update(conversation)
          .set({
            lifecycle: "archived",
            archivedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(conversation.id, current.id),
              eq(conversation.userId, input.userId),
              eq(conversation.lifecycle, "active"),
            ),
          );

        const conversationId = await insertConversationWithOpening(
          transaction,
          {
            userId: input.userId,
            characterId: current.characterId,
            characterVersionId: pinnedVersion.id,
            openingMessage: pinnedVersion.openingMessage,
          },
        );
        return { conversationId };
      });
    },

    async delete(input) {
      await database.transaction(async (transaction) => {
        await lockUserChatMutation(transaction, input.userId);
        const [selectedConversation] = await transaction
          .select({
            id: conversation.id,
          })
          .from(conversation)
          .where(
            and(
              eq(conversation.id, input.conversationId),
              eq(conversation.userId, input.userId),
            ),
          )
          .for("update")
          .limit(1);
        if (!selectedConversation) {
          throw notFound();
        }
        if (
          await hasGenerationLease(transaction, {
            userId: input.userId,
            conversationId: selectedConversation.id,
          })
        ) {
          throw generationInProgress();
        }

        await transaction
          .delete(conversation)
          .where(
            and(
              eq(conversation.id, selectedConversation.id),
              eq(conversation.userId, input.userId),
            ),
          );
      });
    },
  };
}
