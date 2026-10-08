"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireAdmin } from "@/server/admin/require-admin";
import {
  disableOrdinaryUser,
  restoreOrdinaryUser,
} from "@/server/admin/user-service";
import { getDatabase } from "@/server/db/database";

export interface UserAdminActionState {
  status: "idle" | "success" | "error";
  message?: string;
}

const genericErrorMessage = "Unable to update the user. Try again.";

function errorState(error: unknown): UserAdminActionState {
  if (error instanceof Error && error.message) {
    return { status: "error", message: error.message };
  }
  return { status: "error", message: genericErrorMessage };
}

export async function disableUserAction(
  userId: string,
  _state: UserAdminActionState,
  formData: FormData,
): Promise<UserAdminActionState> {
  const actor = await requireAdmin(await headers());
  const confirmed = formData.get("confirm") === "on";
  if (!confirmed) {
    return {
      status: "error",
      message: "Confirm that this user should be disabled.",
    };
  }

  try {
    await disableOrdinaryUser(await getDatabase(), actor, {
      userId,
      reason: String(formData.get("reason") ?? ""),
    });
  } catch (error) {
    return errorState(error);
  }

  revalidatePath("/admin/users");
  return { status: "success", message: "User disabled." };
}

export async function restoreUserAction(
  userId: string,
  _state: UserAdminActionState,
  _formData: FormData,
): Promise<UserAdminActionState> {
  const actor = await requireAdmin(await headers());

  try {
    await restoreOrdinaryUser(await getDatabase(), actor, { userId });
  } catch (error) {
    return errorState(error);
  }

  revalidatePath("/admin/users");
  return { status: "success", message: "User restored." };
}
