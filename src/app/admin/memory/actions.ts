"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireAdmin } from "@/server/admin/require-admin";
import { getDatabase } from "@/server/db/database";
import {
  MemorySettingsAdminError,
  resetGlobalMemorySettings,
  updateGlobalMemorySettings,
} from "@/server/admin/memory-settings-service";
import {
  MemoryOperationAdminError,
  retryDeadLetterOperation,
} from "@/server/admin/memory-operations-service";
import { validOperationId, type MemoryOperationType } from "@/server/admin/memory-operations-queries";

export interface MemorySettingsValues {
  expectedRevision: string;
  enabled: string;
}

export interface MemoryAdminActionState {
  status: "idle" | "success" | "error";
  message?: string;
  values?: MemorySettingsValues;
  fieldErrors?: Partial<Record<keyof MemorySettingsValues, string[]>>;
}

function refresh() {
  revalidatePath("/admin/memory");
  revalidatePath("/admin/usage");
}

function settingsError(error: unknown, values: MemorySettingsValues): MemoryAdminActionState {
  return {
    status: "error",
    values,
    message: error instanceof MemorySettingsAdminError && error.code === "SETTINGS_CONFLICT"
      ? "Settings changed in another session. Reload before trying again."
      : "Unable to change memory settings. Try again.",
  };
}

export async function updateGlobalMemorySettingsAction(
  _state: MemoryAdminActionState,
  formData: FormData,
): Promise<MemoryAdminActionState> {
  const actor = await requireAdmin(await headers());
  const values = {
    expectedRevision: String(formData.get("expectedRevision") ?? "").trim(),
    enabled: String(formData.get("enabled") ?? "").trim(),
  };
  const expectedRevision = Number(values.expectedRevision);
  const fieldErrors: MemoryAdminActionState["fieldErrors"] = {};
  if (!values.expectedRevision || !Number.isSafeInteger(expectedRevision) || expectedRevision <= 0)
    fieldErrors.expectedRevision = ["Reload the settings and try again."];
  if (!["true", "false"].includes(values.enabled))
    fieldErrors.enabled = ["Choose enabled or disabled."];
  if (Object.keys(fieldErrors).length)
    return { status: "error", message: "Check the settings and try again.", values, fieldErrors };
  try {
    const result = await updateGlobalMemorySettings(await getDatabase(), actor, {
      expectedRevision, enabled: values.enabled === "true",
    });
    refresh();
    return {
      status: "success", message: "Memory processing setting saved.",
      values: { ...values, expectedRevision: String(result.revision) },
    };
  } catch (error) {
    return settingsError(error, values);
  }
}

export async function resetGlobalMemorySettingsAction(
  state: MemoryAdminActionState,
  formData: FormData,
): Promise<MemoryAdminActionState> {
  const actor = await requireAdmin(await headers());
  const values = state.values ?? {
    expectedRevision: String(formData.get("expectedRevision") ?? ""),
    enabled: String(formData.get("enabled") ?? ""),
  };
  const expectedRevision = Number(formData.get("expectedRevision"));
  if (formData.get("confirm") !== "on" ||
    !Number.isSafeInteger(expectedRevision) || expectedRevision <= 0)
    return { status: "error", message: "Confirm restoration of deployment defaults.", values };
  try {
    const result = await resetGlobalMemorySettings(await getDatabase(), actor, { expectedRevision });
    refresh();
    return {
      status: "success", message: "Stored deployment default restored.",
      values: { expectedRevision: String(result.revision), enabled: String(result.enabled) },
    };
  } catch (error) {
    return settingsError(error, values);
  }
}

export async function retryMemoryOperationAction(
  _state: MemoryAdminActionState,
  formData: FormData,
): Promise<MemoryAdminActionState> {
  const actor = await requireAdmin(await headers());
  const operationType = formData.get("operationType");
  const operationId = formData.get("operationId");
  if (typeof operationId !== "string" || !validOperationId(operationId) ||
      typeof operationType !== "string" ||
      !["memory_extraction", "summary_refresh", "data_export", "account_purge"].includes(operationType))
    return { status: "error", message: "Operation unavailable. Refresh and try again." };
  try {
    await retryDeadLetterOperation(await getDatabase(), actor, {
      operationType: operationType as MemoryOperationType, operationId,
    });
    refresh();
    return { status: "success", message: "Operation queued for retry." };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof MemoryOperationAdminError && error.code === "RETRY_UNAVAILABLE"
        ? "Operation changed or cannot be retried. Refresh and try again."
        : "Unable to retry operation. Try again.",
    };
  }
}
