"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireAdmin } from "@/server/admin/require-admin";
import {
  disableOrdinaryUser,
  restoreOrdinaryUser,
} from "@/server/admin/user-service";
import {
  ChatSettingsAdminError,
  setUserChatQuotaOverride,
} from "@/server/admin/chat-settings-service";
import { getDatabase } from "@/server/db/database";

export interface UserAdminActionState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: {
    dailyRequestLimit?: string[];
    dailyTokenLimit?: string[];
  };
  values?: {
    dailyRequestLimit: string;
    dailyTokenLimit: string;
  };
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

function parseOptionalPositiveInteger(
  value: string,
): number | null | undefined {
  if (value === "") return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export async function setUserQuotaAction(
  userId: string,
  _state: UserAdminActionState,
  formData: FormData,
): Promise<UserAdminActionState> {
  const actor = await requireAdmin(await headers());
  const values = {
    dailyRequestLimit: String(formData.get("dailyRequestLimit") ?? "").trim(),
    dailyTokenLimit: String(formData.get("dailyTokenLimit") ?? "").trim(),
  };
  const dailyRequestLimit = parseOptionalPositiveInteger(
    values.dailyRequestLimit,
  );
  const dailyTokenLimit = parseOptionalPositiveInteger(values.dailyTokenLimit);
  const fieldErrors: UserAdminActionState["fieldErrors"] = {};
  if (dailyRequestLimit === undefined) {
    fieldErrors.dailyRequestLimit = [
      "Enter a positive whole number or leave blank to inherit.",
    ];
  }
  if (dailyTokenLimit === undefined) {
    fieldErrors.dailyTokenLimit = [
      "Enter a positive whole number or leave blank to inherit.",
    ];
  }
  if (Object.keys(fieldErrors).length > 0) {
    return {
      status: "error",
      message: "Check the quota override fields and try again.",
      fieldErrors,
      values,
    };
  }
  if (dailyRequestLimit === undefined || dailyTokenLimit === undefined) {
    return { status: "error", message: genericErrorMessage, values };
  }

  try {
    await setUserChatQuotaOverride(await getDatabase(), actor, {
      userId,
      dailyRequestLimit,
      dailyTokenLimit,
    });
  } catch (error) {
    const message =
      error instanceof ChatSettingsAdminError ||
      (error instanceof Error &&
        [
          "Administrators cannot manage their own account",
          "Only ordinary users can be managed",
        ].includes(error.message))
        ? error.message
        : genericErrorMessage;
    return { status: "error", message, values };
  }

  revalidatePath("/admin/users");
  revalidatePath("/admin/usage");
  return {
    status: "success",
    message: "User quota override updated.",
    values,
  };
}
