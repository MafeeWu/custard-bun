import {
  lockUserChatMutation,
  type ChatTransaction,
} from "@/server/chat/chat-locks";

export async function lockUserMemoryMutation(
  transaction: ChatTransaction,
  userId: string,
): Promise<void> {
  await lockUserChatMutation(transaction, userId);
}
