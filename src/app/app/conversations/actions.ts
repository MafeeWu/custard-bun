"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireSession } from "@/server/auth/require-session";
import { ChatDomainError } from "@/server/chat/chat-errors";
import {
  getConversationForUser,
  listActiveConversations,
} from "@/server/chat/conversation-queries";
import { createConversationService } from "@/server/chat/conversation-service";
import { getDatabase } from "@/server/db/database";

export interface ConversationActionState {
  status: "idle" | "success" | "error";
  message?: string;
  conversationId?: string;
}

function errorState(error: unknown): ConversationActionState {
  if (error instanceof ChatDomainError) {
    return { status: "error", message: error.toPublicError().message };
  }
  return {
    status: "error",
    message: "Unable to update this conversation. Try again.",
  };
}

export async function startConversationAction(
  characterId: string,
  characterSlug: string,
  _state: ConversationActionState,
  _formData: FormData,
): Promise<ConversationActionState> {
  void _state;
  void _formData;
  const session = await requireSession(await headers());
  const database = await getDatabase();
  let conversationId: string;
  try {
    const result = await createConversationService(database).openOrCreate({
      userId: session.user.id,
      characterId,
    });
    conversationId = result.conversationId;
  } catch (error) {
    return errorState(error);
  }

  revalidatePath("/app");
  revalidatePath(`/characters/${characterSlug}`);
  revalidatePath(`/app/conversations/${conversationId}`);
  redirect(`/app/conversations/${conversationId}`);
}

export async function restartConversationAction(
  conversationId: string,
  characterSlug: string,
  _state: ConversationActionState,
  formData: FormData,
): Promise<ConversationActionState> {
  const session = await requireSession(await headers());
  if (formData.get("confirm") !== "on") {
    return {
      status: "error",
      message: "Confirm that you want to start over.",
    };
  }

  const database = await getDatabase();
  let newConversationId: string;
  try {
    const result = await createConversationService(database).restart({
      userId: session.user.id,
      conversationId,
    });
    newConversationId = result.conversationId;
  } catch (error) {
    return errorState(error);
  }

  revalidatePath("/app");
  revalidatePath(`/characters/${characterSlug}`);
  revalidatePath(`/app/conversations/${conversationId}`);
  revalidatePath(`/app/conversations/${newConversationId}`);
  redirect(`/app/conversations/${newConversationId}`);
}

export async function deleteConversationAction(
  conversationId: string,
  _state: ConversationActionState,
  formData: FormData,
): Promise<ConversationActionState> {
  const session = await requireSession(await headers());
  if (formData.get("confirm") !== "on") {
    return {
      status: "error",
      message: "Confirm that you want to permanently delete this conversation.",
    };
  }

  const database = await getDatabase();
  let returnPath = "/app";
  let characterSlug: string | undefined;
  let characterId: string | undefined;
  try {
    const selected = await getConversationForUser(database, {
      userId: session.user.id,
      conversationId,
    });
    if (!selected) {
      throw new ChatDomainError(
        "CHAT_NOT_FOUND",
        "The requested conversation was not found.",
      );
    }
    characterSlug = selected.character.slug;
    characterId = selected.character.id;
    await createConversationService(database).delete({
      userId: session.user.id,
      conversationId,
    });
    if (selected.lifecycle === "archived") {
      const active = (
        await listActiveConversations(database, session.user.id)
      ).find((candidate) => candidate.character.id === selected.character.id);
      if (active) {
        returnPath = `/app/conversations/${active.id}`;
      }
    }
  } catch (error) {
    return errorState(error);
  }

  revalidatePath("/app");
  revalidatePath(`/app/conversations/${conversationId}`);
  revalidatePath("/app/memories");
  revalidatePath("/account");
  if (characterId) revalidatePath(`/app/memories/${characterId}`);
  if (characterSlug) {
    revalidatePath(`/characters/${characterSlug}`);
  }
  if (returnPath !== "/app") {
    revalidatePath(returnPath);
  }
  redirect(returnPath);
}
