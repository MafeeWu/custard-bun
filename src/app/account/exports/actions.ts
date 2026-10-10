"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/server/auth/require-session";
import { getDatabase } from "@/server/db/database";
import {
  DataExportError,
  getDataExportForUser,
  requestDataExport,
  retryDataExport,
  type DataExportView,
} from "@/server/privacy/data-export-service";

export interface DataExportActionState {
  status: "idle" | "success" | "error";
  exportId?: string;
  message?: string;
}
export async function requestDataExportAction(
  _state: DataExportActionState,
  _data: FormData,
): Promise<DataExportActionState> {
  void _state;
  void _data;
  const session = await requireSession(await headers());
  try {
    const result = await requestDataExport(await getDatabase(), {
      userId: session.user.id,
      now: new Date(),
    });
    revalidatePath("/account");
    return {
      status: "success",
      exportId: result.exportId,
      message:
        "Data export requested. Your private ZIP will be available here when ready.",
    };
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof DataExportError
          ? error.message
          : "Unable to request data export. Try again.",
    };
  }
}
export async function retryDataExportAction(
  _state: DataExportActionState,
  data: FormData,
): Promise<DataExportActionState> {
  const session = await requireSession(await headers());
  try {
    const exportId = data.get("exportId");
    if (typeof exportId !== "string" || exportId.length > 100)
      throw new DataExportError("EXPORT_NOT_FOUND");
    const result = await retryDataExport(await getDatabase(), {
      userId: session.user.id,
      exportId,
      now: new Date(),
    });
    revalidatePath("/account");
    return {
      status: "success",
      exportId: result.exportId,
      message: "Data export retry requested.",
    };
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof DataExportError
          ? error.message
          : "Unable to retry data export. Try again.",
    };
  }
}
export async function getDataExportStatusAction(
  exportId: string,
): Promise<DataExportView | null> {
  const session = await requireSession(await headers());
  if (typeof exportId !== "string" || exportId.length > 100) return null;
  try {
    return await getDataExportForUser(await getDatabase(), {
      userId: session.user.id,
      exportId,
      now: new Date(),
    });
  } catch {
    return null;
  }
}
