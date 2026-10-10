// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { strFromU8, unzipSync } from "fflate";
import { createDatabase } from "@/server/db/client";
import {
  account,
  adminAuditEvent,
  conversationMessage,
  dataExportJob,
  generationAttempt,
  rateLimit,
  session,
  usageLedger,
  user,
  verification,
} from "@/server/db/schema";
import { testDatabaseUrl } from "@/test/database-target";
import {
  resetExtractionDatabase,
  extractionNow,
} from "@/test/memory-extraction-fixture";
import { summaryFixture } from "@/test/memory-summary-fixture";
import {
  editRelationshipSummary,
  DEFAULT_RELATIONSHIP_SUMMARY_POLICY,
} from "@/server/memory/relationship-summary-service";
import { deleteUserWithGenerationSettlement } from "@/server/chat/quota-service";
import {
  requestDataExport,
  getDataExportForUser,
  processDataExport,
  expireDataExports,
  downloadDataExport,
  cancelDataExportsForUser,
  retryDataExport,
} from "./data-export-service";
import {
  buildDataExportArchive,
  EXPORT_ENTRY_NAMES,
} from "./data-export-archive";

const database = createDatabase(testDatabaseUrl());
beforeEach(async () => {
  await resetExtractionDatabase(database);
  await database.execute(
    sql`TRUNCATE verification, rate_limit, admin_audit_events`,
  );
});
afterAll(() => database.$client.end());
const now = extractionNow;
const request = (userId: string) =>
  requestDataExport(database, { userId, now });
const row = async (id: string) =>
  (
    await database.select().from(dataExportJob).where(eq(dataExportJob.id, id))
  )[0];
const decode = (bytes: Buffer) =>
  Object.fromEntries(
    Object.entries(unzipSync(bytes)).map(([name, value]) => [
      name,
      JSON.parse(strFromU8(value)),
    ]),
  );

test("ZIP has a versioned deterministic owner-only allowlist, including evidence and summary history", async () => {
  const owner = await summaryFixture(database);
  const other = await summaryFixture(database);
  await editRelationshipSummary(
    database,
    {
      ...owner,
      content: "Owner summary",
      expectedRevision: 0,
      expectedMemoryEpoch: 0,
      userExplicitlyAskedToRemember: true,
    },
    DEFAULT_RELATIONSHIP_SUMMARY_POLICY,
  );
  await editRelationshipSummary(
    database,
    {
      ...owner,
      content: "Current owner summary",
      expectedRevision: 1,
      expectedMemoryEpoch: 0,
      userExplicitlyAskedToRemember: true,
    },
    DEFAULT_RELATIONSHIP_SUMMARY_POLICY,
  );
  await database.insert(account).values({
    id: "secret-account",
    userId: owner.userId,
    accountId: "private-provider-identity",
    providerId: "private-provider",
    password: "private-password-hash",
    accessToken: "private-token",
  });
  await database.insert(session).values({
    id: "secret-session",
    userId: owner.userId,
    token: "private-session-token",
    expiresAt: new Date("2027-01-01"),
  });
  await database.insert(verification).values({
    id: "secret-verification",
    identifier: owner.userId,
    value: "private-verification-value",
    expiresAt: new Date("2027-01-01"),
  });
  await database.insert(rateLimit).values({
    id: randomUUID(),
    key: "private-rate-key",
    count: 1,
    lastRequest: 1,
  });
  await database.insert(usageLedger).values(
    [owner, other].map((fixture) => ({
      id: randomUUID(),
      userId: fixture.userId,
      conversationId: fixture.conversationId,
      attemptId: fixture.attemptId,
      periodStart: now,
      periodEnd: new Date(now.getTime() + 86400000),
      providerCallNumber: 1,
      userRequestUnits: 1,
      inputTokens: 10,
      outputTokens: 5,
      usageIsEstimated: true,
      modelId: "private-model",
      errorCategory: "private-provider-error",
      outcome: "complete",
    })),
  );
  await database.insert(generationAttempt).values({
    id: randomUUID(),
    userId: owner.userId,
    assistantMessageId: owner.assistantMessageId,
    attemptNumber: 2,
    isCurrent: false,
    modelId: "private-model",
    providerRequestId: "private-provider-request",
    errorCategory: "private-raw-error",
  });
  await database.insert(adminAuditEvent).values({
    id: "owner-audit",
    actorUserId: other.userId,
    actorLabel: "private-admin-label",
    action: "user.disable",
    targetType: "user",
    targetId: owner.userId,
    metadata: { secret: "private-admin-metadata" },
    operationId: "private-operation",
  });
  const { exportId } = await request(owner.userId);
  await processDataExport(database, exportId, now);
  const completed = await row(exportId);
  const archive = decode(completed.archiveBytes!);
  expect(Object.keys(archive).sort()).toEqual([...EXPORT_ENTRY_NAMES].sort());
  expect(archive["manifest.json"]).toMatchObject({
    schemaVersion: 1,
    snapshotAt: now.toISOString(),
  });
  expect(archive["profile.json"]).toMatchObject({
    id: owner.userId,
    name: "Memory User",
  });
  expect(archive["characters.json"][0]).toMatchObject({
    id: owner.characterId,
  });
  expect(archive["conversations.json"].messages).toHaveLength(2);
  expect(
    archive["conversations.json"].attempts.find(
      (attempt: { id: string }) => attempt.id === owner.attemptId,
    ),
  ).toMatchObject({
    content: "I'll remember your preference.",
    status: "complete",
  });
  expect(archive["memories.json"].items[0]).toMatchObject({
    content: "Likes green tea.",
  });
  expect(archive["memories.json"].evidence).not.toHaveLength(0);
  expect(archive["summaries.json"].history[0]).toMatchObject({
    content: "Owner summary",
  });
  expect(archive["summaries.json"].history[1]).toMatchObject({
    content: "Current owner summary",
  });
  expect(archive["summaries.json"].current[0].currentVersionId).toBe(
    archive["summaries.json"].history[1].id,
  );
  expect(archive["usage.json"]).toHaveLength(1);
  expect(archive["usage.json"][0]).toMatchObject({
    inputTokens: 10,
    outputTokens: 5,
    requestUnits: 1,
    workloadType: "chat_generation",
  });
  expect(archive["settings.json"].relationships[0]).toMatchObject({
    recordingEnabled: true,
    usageEnabled: true,
  });
  expect(archive["audit.json"][0]).toEqual({
    id: "owner-audit",
    action: "user.disable",
    targetType: "user",
    targetId: owner.userId,
    createdAt: expect.any(String),
  });
  const text = JSON.stringify(archive);
  for (const forbidden of [
    other.userId,
    other.characterId,
    other.conversationId,
    "private-",
    "password",
    "provider",
    "normalizedDigest",
    "archiveBytes",
    "jobId",
    "recovery",
    "verification",
    "leaseOwner",
    owner.operationId!,
  ])
    expect(text).not.toContain(forbidden);
  expect(completed.archiveSha256).toBe(
    createHash("sha256").update(completed.archiveBytes!).digest("hex"),
  );
  expect(completed.archiveSize).toBe(completed.archiveBytes!.length);
  expect(
    completed.expiresAt!.getTime() - completed.completedAt!.getTime(),
  ).toBe(24 * 60 * 60 * 1000);
  const { "manifest.json": manifest, ...entries } = archive;
  const unzipped = unzipSync(completed.archiveBytes!);
  for (const entry of manifest.entries) {
    expect(entry.bytes).toBe(unzipped[entry.name].length);
    expect(entry.sha256).toBe(
      createHash("sha256").update(unzipped[entry.name]).digest("hex"),
    );
  }
  expect(buildDataExportArchive(entries, manifest.snapshotAt).bytes).toEqual(
    completed.archiveBytes,
  );
});

test("concurrent requests reuse one nonterminal job and other users cannot inspect/retry/download it", async () => {
  const owner = await summaryFixture(database);
  const other = await summaryFixture(database);
  const requests = await Promise.all([
    request(owner.userId),
    request(owner.userId),
  ]);
  expect(requests[0]).toEqual(requests[1]);
  expect(await database.select().from(dataExportJob)).toHaveLength(1);
  const exportId = requests[0].exportId;
  expect(
    await getDataExportForUser(database, {
      userId: other.userId,
      exportId,
      now,
    }),
  ).toBeNull();
  expect(
    await downloadDataExport(database, { userId: other.userId, exportId, now }),
  ).toBeNull();
  await expect(
    retryDataExport(database, { userId: other.userId, exportId, now }),
  ).rejects.toMatchObject({ code: "EXPORT_NOT_FOUND" });
});

test.each(["missing", "banned", "deleting"])(
  "%s account cannot request an export",
  async (state) => {
    const { userId } = await summaryFixture(database);
    if (state === "missing")
      await deleteUserWithGenerationSettlement(database, userId, now);
    else
      await database
        .update(user)
        .set(state === "banned" ? { banned: true } : { deletionPendingAt: now })
        .where(eq(user.id, userId));
    await expect(request(userId)).rejects.toMatchObject({
      code: "EXPORT_UNAVAILABLE",
    });
  },
);

test("size limits reject estimated and final ZIP bytes without storing any private bytes", async () => {
  const { userId } = await summaryFixture(database);
  const { exportId } = await request(userId);
  await processDataExport(database, exportId, now, { maxArchiveBytes: 100 });
  expect(await row(exportId)).toMatchObject({
    status: "failed",
    archiveBytes: null,
    archiveSize: null,
    archiveSha256: null,
    expiresAt: null,
    errorCategory: "size_limit",
  });
  expect(() =>
    buildDataExportArchive(
      { "profile.json": "x".repeat(101) },
      now.toISOString(),
      100,
    ),
  ).toThrow();
  expect(() =>
    buildDataExportArchive({ "profile.json": "" }, now.toISOString(), 140),
  ).toThrow();
  expect(() =>
    buildDataExportArchive({ "../secret.json": {} }, now.toISOString()),
  ).toThrow();
});

test("completed job download is owner-only, idempotent, integrity checked, and expires at the exact boundary", async () => {
  const { userId } = await summaryFixture(database);
  const { exportId } = await request(userId);
  expect(
    await downloadDataExport(database, { userId, exportId, now }),
  ).toBeNull();
  await processDataExport(database, exportId, now);
  const before = await row(exportId);
  await processDataExport(database, exportId, new Date(now.getTime() + 1));
  expect((await row(exportId)).archiveBytes).toEqual(before.archiveBytes);
  expect(
    await downloadDataExport(database, {
      userId,
      exportId,
      now: new Date(before.expiresAt!.getTime() - 1),
    }),
  ).toMatchObject({ bytes: before.archiveBytes });
  expect(
    await downloadDataExport(database, {
      userId,
      exportId,
      now: before.expiresAt!,
    }),
  ).toBeNull();
  expect(await row(exportId)).toMatchObject({
    status: "expired",
    archiveBytes: null,
    archiveSize: null,
    archiveSha256: null,
  });
  expect(await expireDataExports(database, before.expiresAt!)).toBe(0);
});

test("scheduled expiry physically removes bytes and retained metadata never exposes archive internals", async () => {
  const { userId } = await summaryFixture(database);
  const { exportId } = await request(userId);
  await processDataExport(database, exportId, now);
  const view = await getDataExportForUser(database, { userId, exportId, now });
  expect(view).toMatchObject({ id: exportId, status: "complete" });
  expect(JSON.stringify(view)).not.toMatch(/archive|jobId|errorCategory/);
  expect(
    await expireDataExports(database, new Date(now.getTime() + 86400000)),
  ).toBe(1);
  expect((await row(exportId)).archiveBytes).toBeNull();
});

test("cancellation seam and hard deletion make all jobs inaccessible and remove bytes", async () => {
  const { userId } = await summaryFixture(database);
  const { exportId } = await request(userId);
  await processDataExport(database, exportId, now);
  await database.transaction(async (tx) => {
    await cancelDataExportsForUser(tx, userId, now);
    await tx
      .update(user)
      .set({ deletionPendingAt: now })
      .where(eq(user.id, userId));
  });
  expect(await row(exportId)).toBeUndefined();
  expect(
    await downloadDataExport(database, { userId, exportId, now }),
  ).toBeNull();
  await deleteUserWithGenerationSettlement(database, userId, now);
  expect(await row(exportId)).toBeUndefined();
});

test("download independently rejects corrupt stored integrity without returning bytes", async () => {
  const { userId } = await summaryFixture(database);
  const { exportId } = await request(userId);
  await processDataExport(database, exportId, now);
  // Simulate storage corruption after PostgreSQL constraint validation, without weakening constraints.
  const original = database.transaction.bind(database);
  const spy = vi
    .spyOn(database, "transaction")
    .mockImplementation((callback, config) =>
      original(async (tx) => {
        const select = tx.select.bind(tx);
        vi.spyOn(tx, "select").mockImplementation(((
          ...args: Parameters<typeof select>
        ) => {
          const query = select(...args);
          const from = query.from.bind(query);
          query.from = ((table: unknown) => {
            const result = from(table as never);
            if (table === dataExportJob) {
              const execute = result.execute.bind(result);
              vi.spyOn(result, "execute").mockImplementation(
                async (...values) => {
                  const rows = await execute(...values);
                  return (rows as unknown as Record<string, unknown>[]).map(
                    (row) => ({ ...row, archiveSha256: "0".repeat(64) }),
                  ) as typeof rows;
                },
              );
            }
            return result;
          }) as typeof query.from;
          return query;
        }) as typeof tx.select);
        return callback(tx);
      }, config),
    );
  try {
    expect(
      await downloadDataExport(database, { userId, exportId, now }),
    ).toBeNull();
  } finally {
    spy.mockRestore();
  }
});

test("named PostgreSQL repeatable snapshot and deletion serialize across the entire private boundary", async () => {
  const owner = await summaryFixture(database);
  const { exportId } = await request(owner.userId);
  const exporter = createDatabase(testDatabaseUrl(), {
    application_name: "export-snapshot-race",
  });
  const deleter = createDatabase(testDatabaseUrl(), {
    application_name: "export-deletion-race",
  });
  const downloader = createDatabase(testDatabaseUrl(), {
    application_name: "export-download-race",
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reached!: () => void;
  const paused = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const original = exporter.transaction.bind(exporter);
  let capturedArchive: { bytes: Buffer } | undefined;
  const spy = vi
    .spyOn(exporter, "transaction")
    .mockImplementation((callback, config) =>
      original(async (tx) => {
        if (config?.isolationLevel === "repeatable read") {
          const select = tx.select.bind(tx);
          let first = true;
          vi.spyOn(tx, "select").mockImplementation(((
            ...args: Parameters<typeof select>
          ) => {
            const query = select(...args);
            const from = query.from.bind(query);
            query.from = ((table: unknown) => {
              const result = from(table as never);
              if (first) {
                first = false;
                const execute = result.execute.bind(result);
                vi.spyOn(result, "execute").mockImplementation(
                  async (...values) => {
                    const rows = await execute(...values);
                    reached();
                    await gate;
                    return rows;
                  },
                );
              }
              return result;
            }) as typeof query.from;
            return query;
          }) as typeof tx.select);
        }
        const result = await callback(tx);
        if (config?.isolationLevel === "repeatable read")
          capturedArchive = result as { bytes: Buffer };
        return result;
      }, config),
    );
  let processing: Promise<void> | undefined;
  let deletion: Promise<unknown> | undefined;
  let downloading: ReturnType<typeof downloadDataExport> | undefined;
  try {
    processing = processDataExport(exporter, exportId, now);
    await Promise.race([
      paused,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("snapshot did not pause")), 5000),
      ),
    ]);
    // A noncanonical writer tests actual MVCC consistency, not just mutex behavior.
    await database.transaction(async (tx) => {
      await tx
        .update(user)
        .set({ name: "New name" })
        .where(eq(user.id, owner.userId));
      await tx
        .update(conversationMessage)
        .set({ content: "New user message" })
        .where(eq(conversationMessage.id, owner.sourceMessageId));
    });
    deletion = deleter.transaction(async (tx) => {
      await cancelDataExportsForUser(tx, owner.userId, now);
      await tx
        .update(user)
        .set({ deletionPendingAt: now })
        .where(eq(user.id, owner.userId));
    });
    let waiting = false;
    for (let i = 0; i < 100; i++) {
      const result = await database.execute(
        sql`SELECT wait_event_type FROM pg_stat_activity WHERE application_name = 'export-deletion-race' AND wait_event_type = 'Lock'`,
      );
      if (result.rows.length) {
        waiting = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(waiting).toBe(true);
    downloading = downloadDataExport(downloader, {
      userId: owner.userId,
      exportId,
      now,
    });
    let downloadWaiting = false;
    for (let i = 0; i < 100; i++) {
      const result = await database.execute(
        sql`SELECT wait_event_type FROM pg_stat_activity WHERE application_name = 'export-download-race' AND wait_event_type = 'Lock'`,
      );
      if (result.rows.length) {
        downloadWaiting = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(downloadWaiting).toBe(true);
    release();
    await processing;
    await deletion;
    expect(await downloading).toBeNull();
    expect(decode(capturedArchive!.bytes)["profile.json"].name).toBe(
      "Memory User",
    );
    expect(
      decode(capturedArchive!.bytes)["conversations.json"].messages[0].content,
    ).toBe("I prefer green tea.");
    expect(await row(exportId)).toBeUndefined();
    expect(
      await downloadDataExport(database, {
        userId: owner.userId,
        exportId,
        now,
      }),
    ).toBeNull();
    expect(await request(owner.userId).catch((error) => error.code)).toBe(
      "EXPORT_UNAVAILABLE",
    );
  } finally {
    release();
    await Promise.allSettled(
      [processing, deletion, downloading].filter(Boolean),
    );
    spy.mockRestore();
    await Promise.all([
      exporter.$client.end(),
      deleter.$client.end(),
      downloader.$client.end(),
    ]);
  }
});
