import { eq, sql } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { chatSettings } from "@/server/db/chat-schema";
import { memorySettings } from "@/server/db/memory-schema";
import { ChatDomainError } from "./chat-errors";

export type ChatTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];

const transactionLockState = new WeakMap<
  ChatTransaction,
  { globalSettingsLocked: boolean; userIds: Set<string> }
>();

export async function lockUserChatMutation(
  transaction: ChatTransaction,
  userId: string,
): Promise<void> {
  let state = transactionLockState.get(transaction);
  if (!state) {
    state = { globalSettingsLocked: false, userIds: new Set() };
    transactionLockState.set(transaction, state);
  }

  if (!state.globalSettingsLocked) {
    const [settings] = await transaction
      .select({ id: chatSettings.id })
      .from(chatSettings)
      .where(eq(chatSettings.id, "global"))
      .for("update")
      .limit(1);

    if (!settings) {
      throw new ChatDomainError(
        "CHAT_INTERNAL",
        "Chat settings are not initialized.",
      );
    }

    const [selectedMemorySettings] = await transaction
      .select({ id: memorySettings.id })
      .from(memorySettings)
      .where(eq(memorySettings.id, "global"))
      .for("update")
      .limit(1);

    if (!selectedMemorySettings) {
      throw new ChatDomainError(
        "CHAT_INTERNAL",
        "Memory settings are not initialized.",
      );
    }

    state.globalSettingsLocked = true;
  }

  if (state.userIds.has(userId)) {
    return;
  }

  await transaction.execute(sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${"chat-user:" + userId}, 0)
    )
  `);
  state.userIds.add(userId);
}

export async function lockUserCharacterChatMutation(
  transaction: ChatTransaction,
  userId: string,
  characterId: string,
): Promise<void> {
  await transaction.execute(sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${"chat-user-character:" + userId + ":" + characterId}, 0)
    )
  `);
}
