"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireSession } from "@/server/auth/require-session";
import { listActiveConversations } from "@/server/chat/conversation-queries";
import { getDatabase } from "@/server/db/database";
import { MemoryDomainError } from "@/server/memory/memory-errors";
import {
  deleteMemoryItem,
  editMemoryItem,
  forgetCharacter,
  updateMemoryControls,
} from "@/server/memory/memory-service";
import {
  editRelationshipSummary,
  requestSummaryRegeneration,
} from "@/server/memory/relationship-summary-service";
import { retryMemoryExtraction } from "@/server/memory/memory-extraction-service";
import { listMemoryRelationships } from "@/server/memory/memory-queries";

export interface MemoryActionState {
  status: "idle" | "success" | "error" | "conflict";
  message?: string;
  revision?: number;
}

function text(data: FormData, key: string): string {
  const value = data.get(key);
  if (typeof value !== "string")
    throw new MemoryDomainError("MEMORY_VALIDATION", "Invalid form.");
  return value;
}

function revision(data: FormData): number {
  const value = text(data, "expectedRevision");
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw new MemoryDomainError("MEMORY_VALIDATION", "Invalid revision.");
  return Number(value);
}

function confirm(data: FormData) {
  if (data.get("confirm") !== "on")
    throw new MemoryDomainError("MEMORY_VALIDATION", "Confirmation required.");
}

async function refresh(userId: string, characterId: string) {
  for (const path of [
    "/app/memories",
    `/app/memories/${characterId}`,
    "/app",
    "/account",
  ])
    revalidatePath(path);
  const database = await getDatabase();
  const active = (await listActiveConversations(database, userId)).find(
    (row) => row.character.id === characterId,
  );
  if (active) revalidatePath(`/app/conversations/${active.id}`);
}

type Mutation = (userId: string) => Promise<{ revision?: number } | void>;
async function mutate(
  characterId: string,
  operation: Mutation,
): Promise<MemoryActionState> {
  const session = await requireSession(await headers());
  let result: { revision?: number } | void;
  try {
    const relationships = await listMemoryRelationships(
      await getDatabase(),
      session.user.id,
    );
    if (!relationships.some((row) => row.character.id === characterId))
      throw new MemoryDomainError(
        "MEMORY_NOT_FOUND",
        "Relationship not found.",
      );
    result = await operation(session.user.id);
  } catch (error) {
    if (error instanceof MemoryDomainError) {
      if (error.code === "MEMORY_REVISION_CONFLICT") {
        await refresh(session.user.id, characterId);
        return {
          status: "conflict",
          message:
            "Memory changed since it was loaded. Your draft is preserved. Review the refreshed version before saving again.",
        };
      }
      return { status: "error", message: error.publicMessage };
    }
    return { status: "error", message: "Unable to change memory. Try again." };
  }
  await refresh(session.user.id, characterId);
  return {
    status: "success",
    message: "Memory updated.",
    ...(result?.revision !== undefined ? { revision: result.revision } : {}),
  };
}

export async function editMemoryAction(
  characterId: string,
  _state: MemoryActionState,
  data: FormData,
): Promise<MemoryActionState> {
  return mutate(characterId, async (userId) =>
    editMemoryItem(await getDatabase(), {
      userId,
      characterId,
      memoryId: text(data, "memoryId"),
      expectedRevision: revision(data),
      content: text(data, "content"),
      userExplicitlyAskedToRemember: data.get("explicitIntent") === "on",
    }),
  );
}

export async function deleteMemoryAction(
  characterId: string,
  _state: MemoryActionState,
  data: FormData,
): Promise<MemoryActionState> {
  return mutate(characterId, async (userId) => {
    confirm(data);
    return deleteMemoryItem(await getDatabase(), {
      userId,
      characterId,
      memoryId: text(data, "memoryId"),
      expectedRevision: revision(data),
    });
  });
}

export async function updateMemoryControlsAction(
  characterId: string,
  _state: MemoryActionState,
  data: FormData,
): Promise<MemoryActionState> {
  return mutate(characterId, async (userId) =>
    updateMemoryControls(await getDatabase(), {
      userId,
      characterId,
      expectedRevision: revision(data),
      recordingEnabled: data.get("stopRecording") !== "on",
      usageEnabled: data.get("stopUsage") !== "on",
    }),
  );
}

export async function editSummaryAction(
  characterId: string,
  _state: MemoryActionState,
  data: FormData,
): Promise<MemoryActionState> {
  return mutate(characterId, async (userId) => {
    const content =
      data.get("operation") === "clear" ? "" : text(data, "content");
    if (content && data.get("explicitIntent") !== "on")
      throw new MemoryDomainError(
        "MEMORY_VALIDATION",
        "Explicit summary intent required.",
      );
    return editRelationshipSummary(await getDatabase(), {
      userId,
      characterId,
      expectedRevision: revision(data),
      content,
    });
  });
}

export async function regenerateSummaryAction(
  characterId: string,
  _state: MemoryActionState,
  data: FormData,
): Promise<MemoryActionState> {
  return mutate(characterId, async (userId) => {
    await requestSummaryRegeneration(await getDatabase(), {
      userId,
      characterId,
      expectedRevision: revision(data),
    });
  });
}

export async function forgetCharacterAction(
  characterId: string,
  _state: MemoryActionState,
  data: FormData,
): Promise<MemoryActionState> {
  return mutate(characterId, async (userId) => {
    confirm(data);
    return forgetCharacter(await getDatabase(), {
      userId,
      characterId,
      expectedRevision: revision(data),
    });
  });
}

export async function retryExtractionAction(
  characterId: string,
  _state: MemoryActionState,
  data: FormData,
): Promise<MemoryActionState> {
  return mutate(characterId, async (userId) =>
    retryMemoryExtraction(await getDatabase(), {
      userId,
      characterId,
      runId: text(data, "runId"),
    }),
  );
}
