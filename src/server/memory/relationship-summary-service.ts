import "server-only";

import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import {
  lockUserCharacterChatMutation,
  type ChatTransaction,
} from "@/server/chat/chat-locks";
import { getRuntimeConfig } from "@/server/config/load-config";
import type { RuntimeConfig } from "@/server/config/schema";
import type { Database } from "@/server/db/client";
import {
  character,
  memoryItem,
  memorySettings,
  relationshipSummary,
  relationshipSummaryExecution,
  relationshipSummaryRun,
  relationshipSummaryVersion,
  user,
  userCharacterMemorySetting,
} from "@/server/db/schema";
import { lockExtractionRelationship } from "./memory-extraction-service";
import { MemoryDomainError } from "./memory-errors";
import { normalizeMemoryText } from "./memory-normalization";
import { containsCredential } from "./memory-policy";
import { lockUserMemoryMutation } from "./memory-locks";
import { retireExhaustedExecutionAccounting } from "./background-usage-service";

type Scope = { userId: string; characterId: string };
export const MAX_SUMMARY_CHARACTERS = 4000;
export interface RelationshipSummaryPolicy {
  maxSummaryCharacters: number;
  secretValues: readonly string[];
}
export const DEFAULT_RELATIONSHIP_SUMMARY_POLICY: RelationshipSummaryPolicy = {
  maxSummaryCharacters: MAX_SUMMARY_CHARACTERS,
  secretValues: [],
};
export const summaryRunnableStatuses = [
  "pending",
  "queued",
  "running",
  "retrying",
] as const;
export interface RelationshipSummaryView {
  versionId: string;
  content: string;
  origin: "automatic" | "user_edited";
  memoryEpoch: number;
  basedOnMemoryRevision: number;
  revision: number;
  updatedAt: Date;
}

const scopeWhere = (input: Scope) =>
  and(
    eq(relationshipSummary.userId, input.userId),
    eq(relationshipSummary.characterId, input.characterId),
  );

type SummaryRuntimeConfig = {
  public: { memory: Pick<RuntimeConfig["public"]["memory"], "maxSummaryCharacters"> };
  secret: {
    databaseUrl: string;
    betterAuthSecret: string;
    smtp: Pick<RuntimeConfig["secret"]["smtp"], "password">;
    model: Pick<RuntimeConfig["secret"]["model"], "apiKey">;
  };
};

function normalizedSecretValues(values: readonly string[]): string[] {
  return [
    ...new Set(
      values
        .map((value) => value.normalize("NFKC"))
        .filter((value) => [...value].length >= 8),
    ),
  ];
}

export function relationshipSummaryPolicyFromConfig(
  config: SummaryRuntimeConfig,
): RelationshipSummaryPolicy {
  let databasePassword = "";
  try {
    databasePassword = decodeURIComponent(
      new URL(config.secret.databaseUrl).password,
    );
  } catch {
    // Configuration validation owns malformed URLs.
  }
  return {
    maxSummaryCharacters: config.public.memory.maxSummaryCharacters,
    secretValues: normalizedSecretValues([
      config.secret.model.apiKey,
      config.secret.betterAuthSecret,
      config.secret.smtp.password,
      config.secret.databaseUrl,
      databasePassword,
    ]),
  };
}

export function validateRelationshipSummaryPolicy(
  policy: RelationshipSummaryPolicy,
): RelationshipSummaryPolicy {
  if (
    !Number.isSafeInteger(policy.maxSummaryCharacters) ||
    policy.maxSummaryCharacters < 1 ||
    policy.maxSummaryCharacters > MAX_SUMMARY_CHARACTERS
  )
    throw new MemoryDomainError(
      "MEMORY_VALIDATION",
      "Invalid summary content.",
    );
  return policy;
}

export function normalizeSummaryText(
  content: unknown,
  policy: RelationshipSummaryPolicy = DEFAULT_RELATIONSHIP_SUMMARY_POLICY,
): string {
  if (typeof content !== "string" || content.length > 16000)
    throw new MemoryDomainError(
      "MEMORY_VALIDATION",
      "Invalid summary content.",
    );
  const effectivePolicy = validateRelationshipSummaryPolicy(policy);
  const normalized = normalizeMemoryText(content);
  if (
    [...normalized].length > effectivePolicy.maxSummaryCharacters ||
    Buffer.byteLength(normalized, "utf8") > 16000 ||
    containsCredential(normalized.toLocaleLowerCase("en-US")) ||
    normalizedSecretValues(effectivePolicy.secretValues).some((secret) =>
      normalized.includes(secret),
    )
  )
    throw new MemoryDomainError(
      "MEMORY_VALIDATION",
      "Invalid summary content.",
    );
  return normalized;
}

export async function getRelationshipSummary(
  database: Database,
  input: Scope,
): Promise<RelationshipSummaryView | null> {
  const [view] = await database
    .select({
      versionId: relationshipSummaryVersion.id,
      content: relationshipSummaryVersion.content,
      origin: relationshipSummaryVersion.origin,
      memoryEpoch: relationshipSummary.memoryEpoch,
      basedOnMemoryRevision: relationshipSummaryVersion.basedOnMemoryRevision,
      revision: relationshipSummary.revision,
      updatedAt: relationshipSummary.updatedAt,
    })
    .from(relationshipSummary)
    .innerJoin(
      user,
      and(
        eq(user.id, relationshipSummary.userId),
        isNull(user.deletionPendingAt),
        eq(user.banned, false),
      ),
    )
    .innerJoin(
      userCharacterMemorySetting,
      and(
        eq(userCharacterMemorySetting.userId, relationshipSummary.userId),
        eq(
          userCharacterMemorySetting.characterId,
          relationshipSummary.characterId,
        ),
        eq(
          userCharacterMemorySetting.memoryEpoch,
          relationshipSummary.memoryEpoch,
        ),
      ),
    )
    .innerJoin(
      relationshipSummaryVersion,
      and(
        eq(relationshipSummaryVersion.id, relationshipSummary.currentVersionId),
        eq(relationshipSummaryVersion.userId, relationshipSummary.userId),
        eq(
          relationshipSummaryVersion.characterId,
          relationshipSummary.characterId,
        ),
        eq(
          relationshipSummaryVersion.memoryEpoch,
          relationshipSummary.memoryEpoch,
        ),
      ),
    )
    .where(scopeWhere(input))
    .limit(1);
  return view ?? null;
}

export async function lockSummaryState(
  transaction: ChatTransaction,
  input: Scope,
) {
  await transaction
    .select({ id: relationshipSummaryRun.id })
    .from(relationshipSummaryRun)
    .where(
      and(
        eq(relationshipSummaryRun.userId, input.userId),
        eq(relationshipSummaryRun.characterId, input.characterId),
      ),
    )
    .orderBy(asc(relationshipSummaryRun.id))
    .for("update");
  const runs = transaction
    .select({ id: relationshipSummaryRun.id })
    .from(relationshipSummaryRun)
    .where(
      and(
        eq(relationshipSummaryRun.userId, input.userId),
        eq(relationshipSummaryRun.characterId, input.characterId),
      ),
    );
  await transaction
    .select({ id: relationshipSummaryExecution.id })
    .from(relationshipSummaryExecution)
    .where(inArray(relationshipSummaryExecution.runId, runs))
    .orderBy(asc(relationshipSummaryExecution.id))
    .for("update");
  const [current] = await transaction
    .select()
    .from(relationshipSummary)
    .where(scopeWhere(input))
    .for("update")
    .limit(1);
  const [version] = current?.currentVersionId
    ? await transaction
        .select()
        .from(relationshipSummaryVersion)
        .where(
          and(
            eq(relationshipSummaryVersion.id, current.currentVersionId),
            eq(relationshipSummaryVersion.userId, input.userId),
            eq(relationshipSummaryVersion.characterId, input.characterId),
            eq(relationshipSummaryVersion.memoryEpoch, current.memoryEpoch),
          ),
        )
        .for("update")
        .limit(1)
    : [];
  return { current, version };
}

async function requireRelationship(transaction: ChatTransaction, input: Scope) {
  await lockUserMemoryMutation(transaction, input.userId);
  await lockUserCharacterChatMutation(
    transaction,
    input.userId,
    input.characterId,
  );
  const [owner] = await transaction
    .select({ id: user.id })
    .from(user)
    .where(
      and(
        eq(user.id, input.userId),
        isNull(user.deletionPendingAt),
        eq(user.banned, false),
      ),
    )
    .for("update")
    .limit(1);
  const [selectedCharacter] = await transaction
    .select({ id: character.id })
    .from(character)
    .where(eq(character.id, input.characterId))
    .limit(1);
  if (!owner || !selectedCharacter)
    throw new MemoryDomainError(
      "MEMORY_NOT_FOUND",
      "Memory relationship not found.",
    );
  return (await lockExtractionRelationship(transaction, input))!;
}

function confirmRevision(expectedRevision: number, actualRevision: number) {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
    throw new MemoryDomainError(
      "MEMORY_VALIDATION",
      "Invalid summary revision.",
    );
  if (expectedRevision !== actualRevision)
    throw new MemoryDomainError(
      "MEMORY_REVISION_CONFLICT",
      "Summary changed since it was loaded.",
      {
        metadata: { expectedRevision, actualRevision },
      },
    );
}

type SummaryEditInput = Scope & {
  expectedRevision: number;
  expectedMemoryEpoch: number;
  content: string;
  userExplicitlyAskedToRemember?: boolean;
};

function confirmSummaryEpoch(
  expectedMemoryEpoch: number,
  actualMemoryEpoch: number,
) {
  if (!Number.isSafeInteger(expectedMemoryEpoch) || expectedMemoryEpoch < 0)
    throw new MemoryDomainError("MEMORY_VALIDATION", "Invalid summary epoch.");
  if (expectedMemoryEpoch !== actualMemoryEpoch)
    throw new MemoryDomainError(
      "MEMORY_REVISION_CONFLICT",
      "Summary changed since it was loaded.",
    );
}

export async function cancelSummaryRuns(
  transaction: ChatTransaction,
  input: Scope,
  now: Date,
) {
  const runs = await transaction
    .select({ id: relationshipSummaryRun.id })
    .from(relationshipSummaryRun)
    .where(
      and(
        eq(relationshipSummaryRun.userId, input.userId),
        eq(relationshipSummaryRun.characterId, input.characterId),
        inArray(relationshipSummaryRun.status, summaryRunnableStatuses),
      ),
    )
    .orderBy(asc(relationshipSummaryRun.id))
    .for("update");
  if (!runs.length) return;
  const ids = runs.map((run) => run.id);
  await transaction
    .update(relationshipSummaryRun)
    .set({
      status: "cancelled",
      nextRetryAt: null,
      finishedAt: now,
      updatedAt: now,
    })
    .where(inArray(relationshipSummaryRun.id, ids));
  await transaction
    .update(relationshipSummaryExecution)
    .set({ summary: null })
    .where(inArray(relationshipSummaryExecution.runId, ids));
}

export async function editRelationshipSummaryInTransaction(
  transaction: ChatTransaction,
  input: SummaryEditInput,
  policy?: RelationshipSummaryPolicy,
) {
  const settings = await requireRelationship(transaction, input);
  const { current } = await lockSummaryState(transaction, input);
  confirmSummaryEpoch(input.expectedMemoryEpoch, settings.memoryEpoch);
  if (current)
    confirmSummaryEpoch(input.expectedMemoryEpoch, current.memoryEpoch);
  confirmRevision(input.expectedRevision, current?.revision ?? 0);
  const content = normalizeSummaryText(
    input.content,
    policy ?? relationshipSummaryPolicyFromConfig(await getRuntimeConfig()),
  );
  if (content && input.userExplicitlyAskedToRemember !== true)
    throw new MemoryDomainError(
      "MEMORY_VALIDATION",
      "Explicit summary intent required.",
    );
  const now = new Date();
  await cancelSummaryRuns(transaction, input, now);
  const versionId = randomUUID();
  const revision = (current?.revision ?? 0) + 1;
  await transaction.insert(relationshipSummaryVersion).values({
    id: versionId,
    userId: input.userId,
    characterId: input.characterId,
    memoryEpoch: settings.memoryEpoch,
    basedOnMemoryRevision: settings.memoryRevision,
    content,
    origin: "user_edited",
    createdAt: now,
  });
  await transaction
    .insert(relationshipSummary)
    .values({
      userId: input.userId,
      characterId: input.characterId,
      memoryEpoch: settings.memoryEpoch,
      currentVersionId: versionId,
      revision,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [relationshipSummary.userId, relationshipSummary.characterId],
      set: {
        currentVersionId: versionId,
        memoryEpoch: settings.memoryEpoch,
        revision,
        updatedAt: now,
      },
    });
  return { revision, versionId };
}

export async function editRelationshipSummary(
  database: Database,
  input: SummaryEditInput,
  policy?: RelationshipSummaryPolicy,
): Promise<{ revision: number; versionId: string }> {
  const effectivePolicy =
    policy ??
    relationshipSummaryPolicyFromConfig(await getRuntimeConfig());
  return database.transaction((tx) =>
    editRelationshipSummaryInTransaction(tx, input, effectivePolicy),
  );
}

export async function summaryControlsEligible(
  transaction: ChatTransaction,
  input: Scope,
) {
  const [global] = await transaction
    .select({ enabled: memorySettings.enabled })
    .from(memorySettings)
    .where(eq(memorySettings.id, "global"))
    .limit(1);
  const [owner] = await transaction
    .select({ banned: user.banned, deletionPendingAt: user.deletionPendingAt })
    .from(user)
    .where(eq(user.id, input.userId))
    .limit(1);
  const [settings] = await transaction
    .select()
    .from(userCharacterMemorySetting)
    .where(
      and(
        eq(userCharacterMemorySetting.userId, input.userId),
        eq(userCharacterMemorySetting.characterId, input.characterId),
      ),
    )
    .limit(1);
  return global?.enabled &&
    owner &&
    !owner.banned &&
    !owner.deletionPendingAt &&
    settings?.recordingEnabled
    ? settings
    : null;
}

export async function ensureAutomaticSummaryRefresh(
  transaction: ChatTransaction,
  input: Scope,
): Promise<{ operationId: string } | null> {
  const settings = await lockExtractionRelationship(transaction, input);
  if (
    !settings ||
    !(await summaryControlsEligible(transaction, input)) ||
    settings.memoryRevision === 0
  )
    return null;
  const { current, version } = await lockSummaryState(transaction, input);
  if (
    version?.origin === "user_edited" ||
    (version && version.basedOnMemoryRevision >= settings.memoryRevision)
  )
    return null;
  if (!version) {
    const [active] = await transaction
      .select({ id: memoryItem.id })
      .from(memoryItem)
      .where(
        and(
          eq(memoryItem.userId, input.userId),
          eq(memoryItem.characterId, input.characterId),
          eq(memoryItem.memoryEpoch, settings.memoryEpoch),
          eq(memoryItem.isActive, true),
        ),
      )
      .limit(1);
    if (!active) return null;
  }
  return createSummaryRun(
    transaction,
    input,
    settings,
    current?.revision ?? 0,
    false,
  );
}

async function createSummaryRun(
  transaction: ChatTransaction,
  input: Scope,
  settings: typeof userCharacterMemorySetting.$inferSelect,
  expectedSummaryRevision: number,
  explicitRegeneration: boolean,
) {
  const [inserted] = await transaction
    .insert(relationshipSummaryRun)
    .values({
      id: randomUUID(),
      userId: input.userId,
      characterId: input.characterId,
      memoryEpoch: settings.memoryEpoch,
      basedOnMemoryRevision: settings.memoryRevision,
      expectedSummaryRevision,
      explicitRegeneration,
    })
    .onConflictDoNothing()
    .returning({ operationId: relationshipSummaryRun.id });
  if (inserted) return inserted;
  const [existing] = await transaction
    .select()
    .from(relationshipSummaryRun)
    .where(
      and(
        eq(relationshipSummaryRun.userId, input.userId),
        eq(relationshipSummaryRun.characterId, input.characterId),
        eq(relationshipSummaryRun.memoryEpoch, settings.memoryEpoch),
        eq(
          relationshipSummaryRun.basedOnMemoryRevision,
          settings.memoryRevision,
        ),
        eq(
          relationshipSummaryRun.expectedSummaryRevision,
          expectedSummaryRevision,
        ),
      ),
    )
    .limit(1);
  if (
    existing &&
    summaryRunnableStatuses.includes(
      existing.status as (typeof summaryRunnableStatuses)[number],
    )
  )
    return { operationId: existing.id };
  if (
    explicitRegeneration &&
    existing?.status === "failed" &&
    existing.attemptCount < 5
  ) {
    await transaction
      .update(relationshipSummaryRun)
      .set({
        status: "pending",
        finishedAt: null,
        nextRetryAt: null,
        jobId: null,
        errorCategory: null,
        claimToken: null,
        leaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(relationshipSummaryRun.id, existing.id));
    return { operationId: existing.id };
  }
  return null;
}

export async function requestSummaryRegeneration(
  database: Database,
  input: Scope & { expectedRevision: number; expectedMemoryEpoch: number },
): Promise<{ operationId: string }> {
  return database.transaction(async (tx) => {
    const settings = await requireRelationship(tx, input);
    const { current } = await lockSummaryState(tx, input);
    confirmSummaryEpoch(input.expectedMemoryEpoch, settings.memoryEpoch);
    if (current)
      confirmSummaryEpoch(input.expectedMemoryEpoch, current.memoryEpoch);
    confirmRevision(input.expectedRevision, current?.revision ?? 0);
    if (!(await summaryControlsEligible(tx, input)))
      throw new MemoryDomainError(
        "MEMORY_VALIDATION",
        "Summary recording is disabled.",
      );
    const result = await createSummaryRun(
      tx,
      input,
      settings,
      input.expectedRevision,
      true,
    );
    if (!result)
      throw new MemoryDomainError(
        "MEMORY_VALIDATION",
        "Summary refresh has already finished for this revision.",
      );
    return result;
  });
}

export async function retrySummaryRefresh(
  database: Database,
  input: Scope & { operationId: string; administrativeRetry?: boolean },
): Promise<void> {
  await database.transaction(async (tx) => {
    const settings = await requireRelationship(tx, input);
    await tx.select({ id: relationshipSummaryRun.id }).from(relationshipSummaryRun)
      .where(and(eq(relationshipSummaryRun.userId, input.userId),
        eq(relationshipSummaryRun.characterId, input.characterId)))
      .orderBy(asc(relationshipSummaryRun.id)).for("update");
    await tx.select({ id: relationshipSummaryExecution.id })
      .from(relationshipSummaryExecution)
      .where(inArray(relationshipSummaryExecution.runId,
        tx.select({ id: relationshipSummaryRun.id }).from(relationshipSummaryRun)
          .where(and(eq(relationshipSummaryRun.userId, input.userId),
            eq(relationshipSummaryRun.characterId, input.characterId)))))
      .orderBy(asc(relationshipSummaryExecution.id)).for("update");
    const [current] = await tx.select({
      revision: relationshipSummary.revision,
      memoryEpoch: relationshipSummary.memoryEpoch,
      currentVersionId: relationshipSummary.currentVersionId,
    }).from(relationshipSummary).where(scopeWhere(input)).for("update").limit(1);
    const [version] = current?.currentVersionId
      ? await tx.select({ origin: relationshipSummaryVersion.origin })
          .from(relationshipSummaryVersion).where(and(
            eq(relationshipSummaryVersion.id, current.currentVersionId),
            eq(relationshipSummaryVersion.userId, input.userId),
            eq(relationshipSummaryVersion.characterId, input.characterId),
            eq(relationshipSummaryVersion.memoryEpoch, settings.memoryEpoch),
          )).for("update").limit(1)
      : [];
    const [run] = await tx.select({
      id: relationshipSummaryRun.id,
      status: relationshipSummaryRun.status,
      attemptCount: relationshipSummaryRun.attemptCount,
      memoryEpoch: relationshipSummaryRun.memoryEpoch,
      basedOnMemoryRevision: relationshipSummaryRun.basedOnMemoryRevision,
      expectedSummaryRevision: relationshipSummaryRun.expectedSummaryRevision,
      explicitRegeneration: relationshipSummaryRun.explicitRegeneration,
    }).from(relationshipSummaryRun).where(and(
      eq(relationshipSummaryRun.id, input.operationId),
      eq(relationshipSummaryRun.userId, input.userId),
      eq(relationshipSummaryRun.characterId, input.characterId),
    )).limit(1);
    if (!run ||
      !["failed", "dead_letter"].includes(run.status) ||
      (run.attemptCount >= 5 &&
        !(input.administrativeRetry && run.status === "dead_letter")) ||
      !(await summaryControlsEligible(tx, input)) ||
      settings.memoryEpoch !== run.memoryEpoch ||
      settings.memoryRevision !== run.basedOnMemoryRevision ||
      (current?.memoryEpoch ?? settings.memoryEpoch) !== run.memoryEpoch ||
      (current?.revision ?? 0) !== run.expectedSummaryRevision ||
      (version?.origin === "user_edited" && !run.explicitRegeneration))
      throw new MemoryDomainError("MEMORY_VALIDATION", "Summary cannot be retried.");
    const restartExhausted = input.administrativeRetry &&
      run.status === "dead_letter" && run.attemptCount >= 5;
    if (restartExhausted) {
      const executions = await tx.select({ id: relationshipSummaryExecution.id })
        .from(relationshipSummaryExecution)
        .where(eq(relationshipSummaryExecution.runId, run.id));
      await retireExhaustedExecutionAccounting(tx, executions.map(({ id }) => id));
      await tx.delete(relationshipSummaryExecution)
        .where(eq(relationshipSummaryExecution.runId, run.id));
    }
    await tx.update(relationshipSummaryRun).set({
      status: "pending",
      attemptCount: restartExhausted ? 0 : run.attemptCount,
      deadLetterPublishedAt: null,
      finishedAt: null,
      nextRetryAt: null,
      jobId: null,
      errorCategory: null,
      claimToken: null,
      leaseExpiresAt: null,
      updatedAt: new Date(),
    }).where(eq(relationshipSummaryRun.id, run.id));
  });
}

export async function readSummarySource(
  transaction: ChatTransaction,
  run: typeof relationshipSummaryRun.$inferSelect,
) {
  const settings = await summaryControlsEligible(transaction, run);
  if (
    !settings ||
    settings.memoryEpoch !== run.memoryEpoch ||
    settings.memoryRevision !== run.basedOnMemoryRevision ||
    !summaryRunnableStatuses.includes(
      run.status as (typeof summaryRunnableStatuses)[number],
    )
  )
    return null;
  const { current, version } = await lockSummaryState(transaction, run);
  if (
    (current?.memoryEpoch ?? settings.memoryEpoch) !== run.memoryEpoch ||
    (current?.revision ?? 0) !== run.expectedSummaryRevision ||
    (version?.origin === "user_edited" && !run.explicitRegeneration)
  )
    return null;
  const items = await transaction
    .select({ type: memoryItem.type, content: memoryItem.content })
    .from(memoryItem)
    .where(
      and(
        eq(memoryItem.userId, run.userId),
        eq(memoryItem.characterId, run.characterId),
        eq(memoryItem.memoryEpoch, run.memoryEpoch),
        eq(memoryItem.isActive, true),
      ),
    )
    .orderBy(asc(memoryItem.id));
  return {
    items: items.filter(
      (item) =>
        !containsCredential(
          normalizeMemoryText(item.content).toLocaleLowerCase("en-US"),
        ),
    ),
    priorAutomaticSummary:
      version?.origin === "automatic" ? version.content : null,
  };
}
