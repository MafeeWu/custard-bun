import { eq, sql } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { chatSettings } from "@/server/db/chat-schema";
import { ChatDomainError } from "./chat-errors";

export type ChatTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];

export async function lockUserChatMutation(
  transaction: ChatTransaction,
  userId: string,
): Promise<void> {
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

  await transaction.execute(sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${"chat-user:" + userId}, 0)
    )
  `);
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
