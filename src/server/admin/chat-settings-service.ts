import "server-only";

import { eq } from "drizzle-orm";
import { recordAdminAudit } from "@/server/admin/audit";
import type { AdminActor } from "@/server/admin/admin-actor";
import { requireAdminWrite } from "@/server/admin/require-admin-write";
import { user } from "@/server/db/auth-schema";
import { chatSettings, userChatQuotaOverride } from "@/server/db/chat-schema";
import type { Database } from "@/server/db/client";

export type ChatSettingsAdminErrorCode =
  "INVALID_SETTINGS" | "SETTINGS_CONFLICT" | "SETTINGS_NOT_INITIALIZED";

export class ChatSettingsAdminError extends Error {
  constructor(
    readonly code: ChatSettingsAdminErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ChatSettingsAdminError";
  }
}

export interface UpdateGlobalChatSettingsInput {
  expectedRevision: number;
  userDailyRequestLimit: number;
  userDailyTokenLimit: number;
  instanceMonthlyRequestLimit: number;
  instanceMonthlyTokenBudget: number;
  maxConcurrentGenerations: number;
}

export interface GlobalChatSettings {
  revision: number;
  userDailyRequestLimit: number;
  userDailyTokenLimit: number;
  instanceMonthlyRequestLimit: number;
  instanceMonthlyTokenBudget: number;
  maxConcurrentGenerations: number;
}

function invalid(message: string): never {
  throw new ChatSettingsAdminError("INVALID_SETTINGS", message);
}

function positiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    invalid(`${field} must be a positive integer`);
  }
}

function validateRevision(revision: number): void {
  positiveInteger(revision, "Expected revision");
}

function validateGlobalInput(input: UpdateGlobalChatSettingsInput): void {
  validateRevision(input.expectedRevision);
  positiveInteger(input.userDailyRequestLimit, "User daily request limit");
  positiveInteger(input.userDailyTokenLimit, "User daily token limit");
  positiveInteger(
    input.instanceMonthlyRequestLimit,
    "Instance monthly request limit",
  );
  positiveInteger(
    input.instanceMonthlyTokenBudget,
    "Instance monthly token budget",
  );
  positiveInteger(
    input.maxConcurrentGenerations,
    "Maximum concurrent generations",
  );
  if (input.maxConcurrentGenerations > 1_000) {
    invalid("Maximum concurrent generations must not exceed 1000");
  }
  if (input.userDailyRequestLimit > input.instanceMonthlyRequestLimit) {
    invalid(
      "User daily request limit must not exceed the instance monthly request limit",
    );
  }
  if (input.userDailyTokenLimit > input.instanceMonthlyTokenBudget) {
    invalid(
      "User daily token limit must not exceed the instance monthly token budget",
    );
  }
}

function operationalSettings(row: typeof chatSettings.$inferSelect) {
  return {
    revision: row.revision,
    userDailyRequestLimit: row.userDailyRequestLimit,
    userDailyTokenLimit: row.userDailyTokenLimit,
    instanceMonthlyRequestLimit: row.instanceMonthlyRequestLimit,
    instanceMonthlyTokenBudget: row.instanceMonthlyTokenBudget,
    maxConcurrentGenerations: row.maxConcurrentGenerations,
  };
}

function auditSettings(
  previousRevision: number,
  nextRevision: number,
  values: Omit<GlobalChatSettings, "revision">,
) {
  return {
    previousRevision,
    nextRevision,
    ...values,
  };
}

export async function getGlobalChatSettings(
  database: Database,
): Promise<GlobalChatSettings> {
  const [settings] = await database
    .select()
    .from(chatSettings)
    .where(eq(chatSettings.id, "global"))
    .limit(1);
  if (!settings) {
    throw new ChatSettingsAdminError(
      "SETTINGS_NOT_INITIALIZED",
      "Chat settings are not initialized",
    );
  }
  return operationalSettings(settings);
}

export async function updateGlobalChatSettings(
  database: Database,
  actor: AdminActor,
  input: UpdateGlobalChatSettingsInput,
): Promise<{ revision: number }> {
  validateGlobalInput(input);

  return database.transaction(async (transaction) => {
    await requireAdminWrite(transaction, actor);
    const [current] = await transaction
      .select()
      .from(chatSettings)
      .where(eq(chatSettings.id, "global"))
      .for("update")
      .limit(1);
    if (!current) {
      throw new ChatSettingsAdminError(
        "SETTINGS_NOT_INITIALIZED",
        "Chat settings are not initialized",
      );
    }
    if (current.revision !== input.expectedRevision) {
      throw new ChatSettingsAdminError(
        "SETTINGS_CONFLICT",
        "Chat settings changed in another session",
      );
    }

    const nextRevision = current.revision + 1;
    const nextValues = {
      userDailyRequestLimit: input.userDailyRequestLimit,
      userDailyTokenLimit: input.userDailyTokenLimit,
      instanceMonthlyRequestLimit: input.instanceMonthlyRequestLimit,
      instanceMonthlyTokenBudget: input.instanceMonthlyTokenBudget,
      maxConcurrentGenerations: input.maxConcurrentGenerations,
    };
    await transaction
      .update(chatSettings)
      .set({
        ...nextValues,
        revision: nextRevision,
        updatedAt: new Date(),
      })
      .where(eq(chatSettings.id, "global"));
    await recordAdminAudit(transaction, actor, {
      action: "chat.settings.update",
      targetType: "chat_settings",
      targetId: "global",
      metadata: auditSettings(current.revision, nextRevision, nextValues),
    });
    return { revision: nextRevision };
  });
}

export async function resetGlobalChatSettings(
  database: Database,
  actor: AdminActor,
  input: { expectedRevision: number },
): Promise<GlobalChatSettings> {
  validateRevision(input.expectedRevision);

  return database.transaction(async (transaction) => {
    await requireAdminWrite(transaction, actor);
    const [current] = await transaction
      .select()
      .from(chatSettings)
      .where(eq(chatSettings.id, "global"))
      .for("update")
      .limit(1);
    if (!current) {
      throw new ChatSettingsAdminError(
        "SETTINGS_NOT_INITIALIZED",
        "Chat settings are not initialized",
      );
    }
    if (current.revision !== input.expectedRevision) {
      throw new ChatSettingsAdminError(
        "SETTINGS_CONFLICT",
        "Chat settings changed in another session",
      );
    }

    const nextRevision = current.revision + 1;
    const nextValues = {
      userDailyRequestLimit: current.deploymentDefaultUserDailyRequestLimit,
      userDailyTokenLimit: current.deploymentDefaultUserDailyTokenLimit,
      instanceMonthlyRequestLimit:
        current.deploymentDefaultInstanceMonthlyRequestLimit,
      instanceMonthlyTokenBudget:
        current.deploymentDefaultInstanceMonthlyTokenBudget,
      maxConcurrentGenerations:
        current.deploymentDefaultMaxConcurrentGenerations,
    };
    await transaction
      .update(chatSettings)
      .set({
        ...nextValues,
        revision: nextRevision,
        updatedAt: new Date(),
      })
      .where(eq(chatSettings.id, "global"));
    await recordAdminAudit(transaction, actor, {
      action: "chat.settings.reset",
      targetType: "chat_settings",
      targetId: "global",
      metadata: auditSettings(current.revision, nextRevision, nextValues),
    });
    return { revision: nextRevision, ...nextValues };
  });
}

function validateOverride(value: number | null, field: string): void {
  if (value !== null) {
    positiveInteger(value, field);
  }
}

export async function setUserChatQuotaOverride(
  database: Database,
  actor: AdminActor,
  input: {
    userId: string;
    dailyRequestLimit: number | null;
    dailyTokenLimit: number | null;
  },
): Promise<void> {
  if (actor.userId === input.userId) {
    throw new Error("Administrators cannot manage their own account");
  }
  validateOverride(input.dailyRequestLimit, "Daily request limit");
  validateOverride(input.dailyTokenLimit, "Daily token limit");

  await database.transaction(async (transaction) => {
    await requireAdminWrite(transaction, actor);
    const [target] = await transaction
      .select({ id: user.id, role: user.role })
      .from(user)
      .where(eq(user.id, input.userId))
      .for("update")
      .limit(1);
    if (!target || target.role !== "user") {
      throw new Error("Only ordinary users can be managed");
    }

    const [previous] = await transaction
      .select()
      .from(userChatQuotaOverride)
      .where(eq(userChatQuotaOverride.userId, input.userId))
      .for("update")
      .limit(1);
    const clearing =
      input.dailyRequestLimit === null && input.dailyTokenLimit === null;

    if (clearing) {
      await transaction
        .delete(userChatQuotaOverride)
        .where(eq(userChatQuotaOverride.userId, input.userId));
    } else if (previous) {
      await transaction
        .update(userChatQuotaOverride)
        .set({
          dailyRequestLimit: input.dailyRequestLimit,
          dailyTokenLimit: input.dailyTokenLimit,
          revision: previous.revision + 1,
          updatedAt: new Date(),
        })
        .where(eq(userChatQuotaOverride.userId, input.userId));
    } else {
      await transaction.insert(userChatQuotaOverride).values({
        userId: input.userId,
        dailyRequestLimit: input.dailyRequestLimit,
        dailyTokenLimit: input.dailyTokenLimit,
      });
    }

    await recordAdminAudit(transaction, actor, {
      action: clearing ? "user.chat_quota.clear" : "user.chat_quota.update",
      targetType: "user",
      targetId: input.userId,
      metadata: {
        previousDailyRequestLimit: previous?.dailyRequestLimit ?? null,
        previousDailyTokenLimit: previous?.dailyTokenLimit ?? null,
        dailyRequestLimit: input.dailyRequestLimit,
        dailyTokenLimit: input.dailyTokenLimit,
      },
    });
  });
}
