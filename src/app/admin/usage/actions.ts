"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireAdmin } from "@/server/admin/require-admin";
import {
  ChatSettingsAdminError,
  resetGlobalChatSettings,
  updateGlobalChatSettings,
} from "@/server/admin/chat-settings-service";
import { getDatabase } from "@/server/db/database";

export interface GlobalSettingsFormValues {
  expectedRevision: string;
  userDailyRequestLimit: string;
  userDailyTokenLimit: string;
  instanceMonthlyRequestLimit: string;
  instanceMonthlyTokenBudget: string;
  maxConcurrentGenerations: string;
}

export interface UsageAdminActionState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Partial<Record<keyof GlobalSettingsFormValues, string[]>>;
  values?: GlobalSettingsFormValues;
}

const genericErrorMessage = "Unable to update chat settings. Try again.";
const conflictMessage =
  "These settings changed in another session. Reload before trying again.";

function readValues(formData: FormData): GlobalSettingsFormValues {
  return {
    expectedRevision: String(formData.get("expectedRevision") ?? "").trim(),
    userDailyRequestLimit: String(
      formData.get("userDailyRequestLimit") ?? "",
    ).trim(),
    userDailyTokenLimit: String(
      formData.get("userDailyTokenLimit") ?? "",
    ).trim(),
    instanceMonthlyRequestLimit: String(
      formData.get("instanceMonthlyRequestLimit") ?? "",
    ).trim(),
    instanceMonthlyTokenBudget: String(
      formData.get("instanceMonthlyTokenBudget") ?? "",
    ).trim(),
    maxConcurrentGenerations: String(
      formData.get("maxConcurrentGenerations") ?? "",
    ).trim(),
  };
}

function parseValues(values: GlobalSettingsFormValues):
  | {
      success: true;
      data: {
        expectedRevision: number;
        userDailyRequestLimit: number;
        userDailyTokenLimit: number;
        instanceMonthlyRequestLimit: number;
        instanceMonthlyTokenBudget: number;
        maxConcurrentGenerations: number;
      };
    }
  | { success: false; fieldErrors: UsageAdminActionState["fieldErrors"] } {
  const fields = Object.keys(values) as Array<keyof GlobalSettingsFormValues>;
  const fieldErrors: UsageAdminActionState["fieldErrors"] = {};
  const parsed = {} as Record<keyof GlobalSettingsFormValues, number>;
  for (const field of fields) {
    const number = Number(values[field]);
    if (values[field] === "" || !Number.isSafeInteger(number) || number <= 0) {
      fieldErrors[field] = ["Enter a positive whole number."];
    } else {
      parsed[field] = number;
    }
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { success: false, fieldErrors };
  }
  return { success: true, data: parsed };
}

function errorState(
  error: unknown,
  values?: GlobalSettingsFormValues,
): UsageAdminActionState {
  if (error instanceof ChatSettingsAdminError) {
    return {
      status: "error",
      message:
        error.code === "SETTINGS_CONFLICT" ? conflictMessage : error.message,
      values,
    };
  }
  return { status: "error", message: genericErrorMessage, values };
}

function revalidateAdministration() {
  revalidatePath("/admin/usage");
  revalidatePath("/admin/users");
}

export async function updateGlobalChatSettingsAction(
  _state: UsageAdminActionState,
  formData: FormData,
): Promise<UsageAdminActionState> {
  const actor = await requireAdmin(await headers());
  const values = readValues(formData);
  const parsed = parseValues(values);
  if (!parsed.success) {
    return {
      status: "error",
      message: "Check the highlighted fields and try again.",
      fieldErrors: parsed.fieldErrors,
      values,
    };
  }

  try {
    const result = await updateGlobalChatSettings(
      await getDatabase(),
      actor,
      parsed.data,
    );
    revalidateAdministration();
    return {
      status: "success",
      message: "Chat settings updated.",
      values: { ...values, expectedRevision: String(result.revision) },
    };
  } catch (error) {
    return errorState(error, values);
  }
}

export async function resetGlobalChatSettingsAction(
  _state: UsageAdminActionState,
  formData: FormData,
): Promise<UsageAdminActionState> {
  const actor = await requireAdmin(await headers());
  if (formData.get("confirm") !== "on") {
    return {
      status: "error",
      message: "Confirm that deployment defaults should be restored.",
    };
  }
  const expectedRevision = Number(
    String(formData.get("expectedRevision") ?? ""),
  );
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision <= 0) {
    return {
      status: "error",
      message: "Reload the page before restoring deployment defaults.",
    };
  }

  try {
    await resetGlobalChatSettings(await getDatabase(), actor, {
      expectedRevision,
    });
    revalidateAdministration();
    return {
      status: "success",
      message: "Deployment defaults restored.",
    };
  } catch (error) {
    return errorState(error);
  }
}
