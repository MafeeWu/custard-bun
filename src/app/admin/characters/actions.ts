"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/server/admin/require-admin";
import { CharacterDomainError } from "@/server/characters/character-errors";
import { parseCharacterFormData } from "@/server/characters/character-form-data";
import { createCharacterService } from "@/server/characters/character-service";
import { getDatabase } from "@/server/db/database";

export interface AdminActionState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string[]>;
}

const invalidFormMessage = "Check the highlighted fields and try again.";
const genericErrorMessage = "Unable to update the character. Try again.";
const conflictMessage =
  "This draft changed in another session. Reload the page before editing again.";

async function characterService() {
  const actor = await requireAdmin(await headers());
  const database = await getDatabase();
  return createCharacterService({ database, actor });
}

function mapServiceError(error: unknown): AdminActionState {
  if (error instanceof CharacterDomainError) {
    if (error.code === "DRAFT_CONFLICT") {
      return { status: "error", message: conflictMessage };
    }
    return { status: "error", message: error.message };
  }
  return { status: "error", message: genericErrorMessage };
}

function revisionFrom(
  formData: FormData,
):
  | { success: true; expectedRevision: number }
  | { success: false; state: AdminActionState } {
  const raw = String(formData.get("expectedRevision") ?? "").trim();
  const expectedRevision = Number(raw);
  if (raw === "" || !Number.isInteger(expectedRevision)) {
    return {
      success: false,
      state: {
        status: "error",
        message: invalidFormMessage,
        fieldErrors: {
          expectedRevision: ["Expected revision must be a valid number."],
        },
      },
    };
  }
  return { success: true, expectedRevision };
}

function publicRevalidate(slug: string) {
  revalidatePath("/characters");
  revalidatePath(`/characters/${slug}`);
}

function adminRevalidate(characterId?: string) {
  revalidatePath("/admin/characters");
  if (characterId) {
    revalidatePath(`/admin/characters/${characterId}`);
    revalidatePath(`/admin/characters/${characterId}/preview`);
  }
}

export async function createCharacterAction(
  _state: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const service = await characterService();
  const parsed = parseCharacterFormData(formData);
  if (!parsed.success) {
    return {
      status: "error",
      message: invalidFormMessage,
      fieldErrors: parsed.fieldErrors,
    };
  }
  if (!parsed.data.slug) {
    return {
      status: "error",
      message: invalidFormMessage,
      fieldErrors: { slug: ["Slug is required."] },
    };
  }
  let characterId: string;
  try {
    const result = await service.createCharacter({
      slug: parsed.data.slug,
      content: parsed.data.content,
    });
    characterId = result.characterId;
  } catch (error) {
    return mapServiceError(error);
  }

  adminRevalidate(characterId);
  redirect(`/admin/characters/${characterId}`);
}

export async function saveCharacterDraftAction(
  characterId: string,
  _state: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const service = await characterService();
  const parsed = parseCharacterFormData(formData);
  if (!parsed.success) {
    return {
      status: "error",
      message: invalidFormMessage,
      fieldErrors: parsed.fieldErrors,
    };
  }
  if (parsed.data.expectedRevision === undefined) {
    return {
      status: "error",
      message: invalidFormMessage,
      fieldErrors: {
        expectedRevision: ["Expected revision must be a valid number."],
      },
    };
  }
  try {
    const result = await service.saveDraft({
      characterId,
      expectedRevision: parsed.data.expectedRevision,
      content: parsed.data.content,
    });
    adminRevalidate(characterId);
    return {
      status: "success",
      message: `Saved draft revision ${result.draftRevision}.`,
    };
  } catch (error) {
    return mapServiceError(error);
  }
}

export async function publishCharacterDraftAction(
  characterId: string,
  slug: string,
  _state: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const service = await characterService();
  const revision = revisionFrom(formData);
  if (!revision.success) {
    return revision.state;
  }
  try {
    const result = await service.publishDraft({
      characterId,
      expectedRevision: revision.expectedRevision,
    });
    adminRevalidate(characterId);
    publicRevalidate(slug);
    return {
      status: "success",
      message: `Published version ${result.versionNumber}.`,
    };
  } catch (error) {
    return mapServiceError(error);
  }
}

export async function setDefaultCharacterVersionAction(
  characterId: string,
  slug: string,
  _state: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const service = await characterService();
  const versionId = String(formData.get("versionId") ?? "").trim();
  if (!versionId) {
    return {
      status: "error",
      message: invalidFormMessage,
      fieldErrors: { versionId: ["Choose a published version."] },
    };
  }
  try {
    await service.setDefaultVersion({ characterId, versionId });
    adminRevalidate(characterId);
    publicRevalidate(slug);
    return { status: "success", message: "Default version updated." };
  } catch (error) {
    return mapServiceError(error);
  }
}

export async function archiveCharacterAction(
  characterId: string,
  slug: string,
  _state: AdminActionState,
  _formData: FormData,
): Promise<AdminActionState> {
  const service = await characterService();
  try {
    await service.setArchived({ characterId, archived: true });
    adminRevalidate(characterId);
    publicRevalidate(slug);
    return { status: "success", message: "Character archived." };
  } catch (error) {
    return mapServiceError(error);
  }
}

export async function restoreCharacterAction(
  characterId: string,
  slug: string,
  _state: AdminActionState,
  _formData: FormData,
): Promise<AdminActionState> {
  const service = await characterService();
  try {
    await service.setArchived({ characterId, archived: false });
    adminRevalidate(characterId);
    publicRevalidate(slug);
    return { status: "success", message: "Character restored." };
  } catch (error) {
    return mapServiceError(error);
  }
}
