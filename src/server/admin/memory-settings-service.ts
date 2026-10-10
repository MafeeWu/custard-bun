import "server-only";

import { eq } from "drizzle-orm";
import type { AdminActor } from "./admin-actor";
import { recordAdminAudit } from "./audit";
import { requireAdminWrite } from "./require-admin-write";
import { lockGlobalChatMutation } from "@/server/chat/chat-locks";
import type { Database } from "@/server/db/client";
import { memorySettings } from "@/server/db/memory-schema";

export type MemorySettingsAdminErrorCode =
  "INVALID_SETTINGS" | "SETTINGS_CONFLICT" | "SETTINGS_NOT_INITIALIZED";

export class MemorySettingsAdminError extends Error {
  constructor(readonly code: MemorySettingsAdminErrorCode) {
    super({
      INVALID_SETTINGS: "Invalid memory settings.",
      SETTINGS_CONFLICT: "Memory settings changed in another session.",
      SETTINGS_NOT_INITIALIZED: "Memory settings are not initialized.",
    }[code]);
    this.name = "MemorySettingsAdminError";
  }
}

export interface GlobalMemorySettings {
  revision: number;
  enabled: boolean;
}

function validateRevision(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new MemorySettingsAdminError("INVALID_SETTINGS");
}

export async function getGlobalMemorySettings(database: Database): Promise<GlobalMemorySettings> {
  const [settings] = await database.select({
    enabled: memorySettings.enabled, revision: memorySettings.revision,
  }).from(memorySettings).where(eq(memorySettings.id, "global")).limit(1);
  if (!settings) throw new MemorySettingsAdminError("SETTINGS_NOT_INITIALIZED");
  return settings;
}

async function mutate(
  database: Database,
  actor: AdminActor,
  input: { expectedRevision: number; enabled?: boolean },
  reset: boolean,
): Promise<GlobalMemorySettings> {
  validateRevision(input.expectedRevision);
  if (!reset && typeof input.enabled !== "boolean")
    throw new MemorySettingsAdminError("INVALID_SETTINGS");
  return database.transaction(async (transaction) => {
    await lockGlobalChatMutation(transaction);
    await requireAdminWrite(transaction, actor);
    const [current] = await transaction.select({
      enabled: memorySettings.enabled,
      revision: memorySettings.revision,
      deploymentDefaultEnabled: memorySettings.deploymentDefaultEnabled,
    }).from(memorySettings).where(eq(memorySettings.id, "global")).limit(1);
    if (!current) throw new MemorySettingsAdminError("SETTINGS_NOT_INITIALIZED");
    if (current.revision !== input.expectedRevision)
      throw new MemorySettingsAdminError("SETTINGS_CONFLICT");
    const enabled = reset ? current.deploymentDefaultEnabled : input.enabled!;
    const revision = current.revision + 1;
    await transaction.update(memorySettings)
      .set({ enabled, revision, updatedAt: new Date() })
      .where(eq(memorySettings.id, "global"));
    await recordAdminAudit(transaction, actor, {
      action: reset ? "memory.settings.reset" : "memory.settings.update",
      targetType: "memory_settings",
      targetId: "global",
      metadata: {
        previousRevision: current.revision,
        nextRevision: revision,
        previousEnabled: current.enabled,
        enabled,
      },
    });
    return { enabled, revision };
  });
}

export async function updateGlobalMemorySettings(
  database: Database,
  actor: AdminActor,
  input: { expectedRevision: number; enabled: boolean },
): Promise<{ revision: number }> {
  const { revision } = await mutate(database, actor, input, false);
  return { revision };
}

export async function resetGlobalMemorySettings(
  database: Database,
  actor: AdminActor,
  input: { expectedRevision: number },
): Promise<GlobalMemorySettings> {
  return mutate(database, actor, input, true);
}
