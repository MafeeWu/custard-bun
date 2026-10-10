// @vitest-environment node
import { createHash } from "node:crypto";
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase } from "@/server/db/client";
import {
  account,
  accountDeletionRequest,
  dataExportJob,
  memoryExtractionRun,
  relationshipSummaryRun,
  session,
  user,
  userCharacterMemorySetting,
  generationAttempt,
  generationLease,
  quotaReservation,
  quotaBucket,
  usageLedger,
  memoryItem,
  relationshipSummaryVersion,
} from "@/server/db/schema";
import { testDatabaseUrl } from "@/test/database-target";
import {
  extractionNow as now,
  resetExtractionDatabase,
  waitForExtractionLock,
  extractionAttempt,
  extractionFixture,
  extractionGateway,
  extractionCounter,
  extractionCandidate,
  extractionResult,
} from "@/test/memory-extraction-fixture";
import { summaryFixture, summaryResult } from "@/test/memory-summary-fixture";
import { lockUserChatMutation } from "@/server/chat/chat-locks";
import {
  requestDataExport,
  processDataExport,
  downloadDataExport,
} from "./data-export-service";
import { MAX_EXPORT_ARCHIVE_BYTES } from "./data-export-archive";
import { processEmail } from "@/server/email/process-email";
import { admitBackgroundModelWork } from "@/server/memory/background-usage-service";
import { createConversationService } from "@/server/chat/conversation-service";
import {
  getConversationForUser,
  listActiveConversations,
} from "@/server/chat/conversation-queries";
import { admitGeneration, settleGeneration } from "@/server/chat/quota-service";
import { createExtractionRunForCompletedAttempt } from "@/server/memory/memory-extraction-service";
import { processMemoryExtractionRun } from "@/server/memory/memory-job";
import { processRelationshipSummaryRefresh } from "@/server/memory/relationship-summary-job";
import { processAccountPurgeStage } from "./account-purge-job";
import * as snapshotService from "./data-export-snapshot";
import {
  confirmAccountDeletion,
  requestAccountDeletion,
} from "./account-deletion-service";

vi.mock("@/server/config/load-config", () => ({
  getRuntimeConfig: async () => ({
    public: { memory: { maxActiveItemsPerCharacter: 200, maxItemCharacters: 500 } },
    secret: { betterAuthSecret: "deletion-test-signing-secret-at-least-32" },
  }),
}));
const database = createDatabase(testDatabaseUrl());
beforeEach(() => resetExtractionDatabase(database));
afterAll(() => database.$client.end());
const request = (userId: string) =>
  requestAccountDeletion(database, {
    userId,
    email: `${userId}@example.com`,
    now,
  });
const row = async (id: string) =>
  (
    await database
      .select()
      .from(accountDeletionRequest)
      .where(eq(accountDeletionRequest.id, id))
  )[0];
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("the real exporter can yield after its durable claim, then resume the same cancelled execution without publishing", async () => {
  const owner = await summaryFixture(database);
  const { exportId } = await requestDataExport(database, {
    userId: owner.userId,
    now,
  });
  const requested = await request(owner.userId);
  const afterClaim = vi.fn(
    async (claim: { exportId: string; attemptCount: number }) => {
      expect(claim).toMatchObject({ exportId, attemptCount: 1 });
      const exporting = await database
        .select()
        .from(dataExportJob)
        .where(eq(dataExportJob.id, exportId));
      expect(exporting[0]).toMatchObject({
        status: "running",
        attemptCount: 1,
        archiveBytes: null,
      });
      // A second normal execution must still decline the fresh lease.
      await processDataExport(database, exportId, now);
      expect(
        (
          await database
            .select()
            .from(dataExportJob)
            .where(eq(dataExportJob.id, exportId))
        )[0].attemptCount,
      ).toBe(1);
      await confirmAccountDeletion(database, {
        token: requested.verificationToken,
        now,
      });
    },
  );
  const policy = { maxArchiveBytes: MAX_EXPORT_ARCHIVE_BYTES, afterClaim };
  await processDataExport(database, exportId, now, policy);
  expect(afterClaim).toHaveBeenCalledOnce();
  expect(
    (
      await database
        .select()
        .from(dataExportJob)
        .where(eq(dataExportJob.id, exportId))
    )[0],
  ).toMatchObject({
    status: "cancelled",
    attemptCount: 1,
    archiveBytes: null,
    archiveSize: null,
    archiveSha256: null,
  });
  expect(
    (await database.select().from(userCharacterMemorySetting))[0].memoryEpoch,
  ).toBe(1);
  expect(
    await downloadDataExport(database, { userId: owner.userId, exportId, now }),
  ).toBeNull();
});

test("confirmation consumes a hashed token, locks out immediately, advances epochs, cancels all work and replays without another mutation", async () => {
  const owner = await summaryFixture(database);
  await database.insert(session).values({
    id: "retained",
    token: "private-cookie",
    userId: owner.userId,
    expiresAt: new Date("2027-01-01"),
    updatedAt: now,
  });
  const exportJob = await requestDataExport(database, {
    userId: owner.userId,
    now,
  });
  const requested = await request(owner.userId);
  expect((await row(requested.requestId)).verificationTokenHash).toBe(
    createHash("sha256").update(requested.verificationToken).digest("hex"),
  );
  expect(JSON.stringify(await row(requested.requestId))).not.toContain(
    requested.verificationToken,
  );
  expect(
    await confirmAccountDeletion(database, {
      token: requested.verificationToken,
      now,
    }),
  ).toEqual({ requestId: requested.requestId });
  expect(
    (await database.select().from(user).where(eq(user.id, owner.userId)))[0]
      .deletionPendingAt,
  ).toEqual(now);
  expect(await database.select().from(session)).toHaveLength(0);
  expect(
    (await database.select().from(userCharacterMemorySetting))[0].memoryEpoch,
  ).toBe(1);
  expect((await database.select().from(relationshipSummaryRun))[0].status).toBe(
    "cancelled",
  );
  expect(
    (
      await database
        .select()
        .from(dataExportJob)
        .where(eq(dataExportJob.id, exportJob.exportId))
    )[0].status,
  ).toBe("cancelled");
  const locked = await row(requested.requestId);
  expect(locked).toMatchObject({
    status: "locked",
    currentStage: "settle",
    verificationTokenHash: null,
    verificationExpiresAt: null,
    verificationConsumedAt: now,
  });
  expect(
    await confirmAccountDeletion(database, {
      token: requested.verificationToken,
      now,
    }),
  ).toEqual({ requestId: requested.requestId });
  expect(await row(requested.requestId)).toEqual(locked);
  expect(await database.select().from(accountDeletionRequest)).toHaveLength(1);
  expect((await database.select().from(memoryExtractionRun))[0].status).toBe(
    "cancelled",
  );
});

test("wrong owner, malformed, tampered, replaced and expired tokens never lock out", async () => {
  const owner = await summaryFixture(database);
  await expect(
    requestAccountDeletion(database, {
      userId: owner.userId,
      email: "other@example.com",
      now,
    }),
  ).rejects.toThrow("DELETION_UNAVAILABLE");
  const first = await request(owner.userId);
  const second = await request(owner.userId);
  for (const token of [
    "missing",
    first.verificationToken,
    second.verificationToken + "x",
  ]) {
    await expect(
      confirmAccountDeletion(database, { token, now }),
    ).rejects.toThrow("DELETION_UNAVAILABLE");
  }
  await expect(
    confirmAccountDeletion(database, {
      token: second.verificationToken,
      now: new Date(now.getTime() + 86_400_000),
    }),
  ).rejects.toThrow("DELETION_UNAVAILABLE");
  expect((await database.select().from(user))[0].deletionPendingAt).toBeNull();
});

test("application verification requests have an owner-scoped hourly limit without rotating the last valid token on rejection", async () => {
  const owner = await summaryFixture(database);
  let latest!: Awaited<ReturnType<typeof request>>;
  for (let count = 0; count < 3; count++) latest = await request(owner.userId);
  const before = await row(latest.requestId);
  await expect(request(owner.userId)).rejects.toThrow(
    /^DELETION_RATE_LIMITED$/,
  );
  expect(await row(latest.requestId)).toEqual(before);
  await expect(
    requestAccountDeletion(database, {
      userId: owner.userId,
      email: `${owner.userId}@example.com`,
      now: new Date(now.getTime() + 3_600_001),
    }),
  ).resolves.toHaveProperty("requestId", latest.requestId);
});

test("database rejects auth writes and late session insertion after confirmation, with no private rows recreated", async () => {
  const owner = await summaryFixture(database);
  await database.insert(account).values({
    id: "credential",
    userId: owner.userId,
    accountId: owner.userId,
    providerId: "credential",
    password: "old",
    updatedAt: now,
  });
  const requested = await request(owner.userId);
  await confirmAccountDeletion(database, {
    token: requested.verificationToken,
    now,
  });
  await expect(
    database.insert(session).values({
      id: "late",
      token: "late-private-token",
      userId: owner.userId,
      expiresAt: new Date("2027-01-01"),
      updatedAt: now,
    }),
  ).rejects.toThrow();
  await expect(
    database
      .update(account)
      .set({ password: "new-private-password" })
      .where(eq(account.id, "credential")),
  ).rejects.toThrow();
  await expect(
    database
      .update(user)
      .set({ name: "new-private-name" })
      .where(eq(user.id, owner.userId)),
  ).rejects.toThrow();
  expect(await database.select().from(session)).toHaveLength(0);
  expect((await database.select().from(user))[0].name).toBe("Memory User");
  let deliveries = 0;
  for (const kind of [
    "delete-account",
    "verify-email",
    "reset-password",
  ] as const)
    await processEmail(
      database,
      {
        kind,
        to: `${owner.userId}@example.com`,
        actionUrl: `http://localhost/account/delete/confirm#token=${requested.verificationToken}`,
        deletionRequestId: requested.requestId,
      },
      async () => {
        deliveries++;
      },
    );
  expect(deliveries).toBe(0);
});

test("direct product owners reject conversation reads/mutations and background admission after lockout", async () => {
  const owner = await summaryFixture(database);
  const requested = await request(owner.userId);
  await confirmAccountDeletion(database, {
    token: requested.verificationToken,
    now,
  });
  expect(await getConversationForUser(database, owner)).toBeNull();
  expect(await listActiveConversations(database, owner.userId)).toEqual([]);
  await expect(
    createConversationService(database).openOrCreate(owner),
  ).rejects.toThrow();
  await expect(
    createConversationService(database).restart(owner),
  ).rejects.toThrow();
  await expect(
    createConversationService(database).delete(owner),
  ).rejects.toThrow();
  await expect(
    database.transaction((tx) =>
      admitBackgroundModelWork(tx, {
        userId: owner.userId,
        operationId: "late",
        workloadType: "memory_extraction",
        estimatedTokens: 10,
        now,
      }),
    ),
  ).rejects.toThrow();
});

test("named PostgreSQL email worker waits for an uncommitted signup before determining delivery eligibility", async () => {
  const contender = createDatabase(testDatabaseUrl(), {
    application_name: "deletion-signup-email-race",
  });
  let delivery!: Promise<void>;
  let delivered = 0;
  try {
    await database.transaction(async (tx) => {
      await tx.insert(user).values({
        id: "signup-owner",
        name: "Signup",
        email: "signup@example.com",
      });
      delivery = processEmail(
        contender,
        {
          kind: "verify-email",
          to: "signup@example.com",
          actionUrl: "https://example.com/verify",
        },
        async () => {
          delivered++;
        },
      );
      expect(
        await waitForExtractionLock(database, "deletion-signup-email-race"),
      ).toContain("chat_settings");
      expect(delivered).toBe(0);
    });
    await delivery;
    expect(delivered).toBe(1);
  } finally {
    await Promise.allSettled(delivery ? [delivery] : []);
    await contender.$client.end();
  }
});

test("named PostgreSQL duplicate confirmation waits on global settings before the user/request and has one terminal transition", async () => {
  const owner = await summaryFixture(database);
  const requested = await request(owner.userId);
  const contender = createDatabase(testDatabaseUrl(), {
    application_name: "deletion-confirm-race",
  });
  try {
    let pending!: Promise<unknown>;
    await database.transaction(async (tx) => {
      await lockUserChatMutation(tx, owner.userId);
      pending = Promise.all([
        confirmAccountDeletion(contender, {
          token: requested.verificationToken,
          now,
        }),
        confirmAccountDeletion(contender, {
          token: requested.verificationToken,
          now,
        }),
      ]);
      expect(
        await waitForExtractionLock(database, "deletion-confirm-race"),
      ).toContain("chat_settings");
    });
    await pending;
    expect(
      (await database.select().from(userCharacterMemorySetting))[0].memoryEpoch,
    ).toBe(1);
  } finally {
    await contender.$client.end();
  }
});

test("named PostgreSQL generation settlement queued after confirmation is exactly-once and cannot apply stale provider content", async () => {
  const owner = await extractionFixture(database);
  const attempt = await extractionAttempt(
    database,
    owner,
    1,
    "private-input",
    "pending",
  );
  const admission = await database.transaction((tx) =>
    admitGeneration(tx, {
      ...owner,
      assistantMessageId: attempt.assistantMessageId,
      estimatedInputTokens: 10,
      maxOutputTokens: 20,
      now,
    }),
  );
  const requested = await request(owner.userId);
  const confirmer = createDatabase(testDatabaseUrl(), {
    application_name: "deletion-generation-confirm",
  });
  const settler = createDatabase(testDatabaseUrl(), {
    application_name: "deletion-generation-settle",
  });
  let confirmation!: ReturnType<typeof confirmAccountDeletion>;
  let settlement!: ReturnType<typeof settleGeneration>;
  try {
    await database.transaction(async (tx) => {
      await tx
        .select()
        .from(user)
        .where(eq(user.id, owner.userId))
        .for("update");
      confirmation = confirmAccountDeletion(confirmer, {
        token: requested.verificationToken,
        now,
      });
      expect(
        await waitForExtractionLock(database, "deletion-generation-confirm"),
      ).toContain('"user"');
      settlement = settleGeneration(settler, {
        attemptId: admission.attemptId,
        leaseOwner: admission.leaseOwner,
        outcome: "complete",
        now,
        providerCalls: [
          {
            callNumber: 1,
            modelId: "test-model",
            estimatedInputTokens: 10,
            estimatedOutputTokens: 20,
            inputTokens: 13,
            outputTokens: 7,
          },
        ],
      });
      expect(
        await waitForExtractionLock(database, "deletion-generation-settle"),
      ).toContain("chat_settings");
    });
    await confirmation;
    expect(await settlement).toBeUndefined();
    expect((await database.select().from(generationAttempt))[0]).toMatchObject({
      status: "interrupted",
      cancelRequestedAt: now,
    });
    expect((await database.select().from(quotaReservation))[0].status).toBe(
      "settled",
    );
    expect(await database.select().from(generationLease)).toHaveLength(0);
    expect(await database.select().from(usageLedger)).toHaveLength(1);
    for (const bucket of await database.select().from(quotaBucket))
      expect(bucket).toMatchObject({ reservedRequests: 0, reservedTokens: 0 });
  } finally {
    await Promise.allSettled([confirmation, settlement].filter(Boolean));
    await confirmer.$client.end();
    await settler.$client.end();
  }
});

test("named PostgreSQL session insertion ordered after confirmation cannot recreate a usable cookie", async () => {
  const owner = await summaryFixture(database);
  const requested = await request(owner.userId);
  const confirmer = createDatabase(testDatabaseUrl(), {
    application_name: "deletion-session-confirm",
  });
  const inserter = createDatabase(testDatabaseUrl(), {
    application_name: "deletion-session-insert",
  });
  let confirmation!: ReturnType<typeof confirmAccountDeletion>;
  let insertion!: Promise<boolean>;
  try {
    await database.transaction(async (tx) => {
      await tx
        .select()
        .from(user)
        .where(eq(user.id, owner.userId))
        .for("update");
      confirmation = confirmAccountDeletion(confirmer, {
        token: requested.verificationToken,
        now,
      });
      await waitForExtractionLock(database, "deletion-session-confirm");
      insertion = Promise.resolve(
        inserter.insert(session).values({
          id: "racing-session",
          token: "private-racing-cookie",
          userId: owner.userId,
          expiresAt: new Date("2027-01-01"),
          updatedAt: now,
        }),
      ).then(
        () => true,
        () => false,
      );
      expect(
        await waitForExtractionLock(database, "deletion-session-insert"),
      ).toContain("session");
    });
    await confirmation;
    expect(await insertion).toBe(false);
    expect(await database.select().from(session)).toHaveLength(0);
  } finally {
    await Promise.allSettled([confirmation, insertion].filter(Boolean));
    await confirmer.$client.end();
    await inserter.$client.end();
  }
});

test.each(["extraction", "summary"] as const)(
  "named PostgreSQL stale %s result waits behind confirmation, settles only once and never recreates content after purge",
  async (kind) => {
    const owner =
      kind === "summary"
        ? await summaryFixture(database)
        : await extractionFixture(database);
    let runId: string;
    let sourceMessageId = "";
    if (kind === "extraction") {
      const attempt = await extractionAttempt(database, owner);
      sourceMessageId = attempt.sourceMessageId;
      runId = (await database.transaction((tx) =>
        createExtractionRunForCompletedAttempt(tx, {
          ...owner,
          ...attempt,
          now,
        }),
      ))!.runId;
    } else
      runId = (owner as Awaited<ReturnType<typeof summaryFixture>>)
        .operationId!;
    const requested = await request(owner.userId);
    const entered = deferred();
    const release = deferred();
    const worker = createDatabase(testDatabaseUrl(), {
      application_name: `deletion-${kind}-result`,
    });
    const confirmer = createDatabase(testDatabaseUrl(), {
      application_name: `deletion-${kind}-confirm`,
    });
    let calls = 0;
    const gateway = extractionGateway(async () => {
      calls++;
      entered.resolve();
      await release.promise;
      return kind === "summary"
        ? summaryResult("private-stale-summary")
        : extractionResult([
            extractionCandidate(sourceMessageId, {
              content: "private-stale-memory",
            }),
          ]);
    });
    const work =
      kind === "summary"
        ? processRelationshipSummaryRefresh(
            worker,
            gateway,
            extractionCounter,
            runId,
            new AbortController().signal,
          )
        : processMemoryExtractionRun(
            worker,
            gateway,
            extractionCounter,
            runId,
            new AbortController().signal,
          );
    let confirmation!: ReturnType<typeof confirmAccountDeletion>;
    try {
      await entered.promise;
      await database.transaction(async (tx) => {
        await tx
          .select()
          .from(user)
          .where(eq(user.id, owner.userId))
          .for("update");
        confirmation = confirmAccountDeletion(confirmer, {
          token: requested.verificationToken,
          now,
        });
        await waitForExtractionLock(database, `deletion-${kind}-confirm`);
        release.resolve();
        expect(
          await waitForExtractionLock(database, `deletion-${kind}-result`),
        ).toContain("chat_settings");
      });
      await confirmation;
      await work;
      const ledger = await database.select().from(usageLedger);
      expect(ledger).toHaveLength(1);
      expect(
        (await database.select().from(memoryItem)).some((item) =>
          item.content.includes("private-stale"),
        ),
      ).toBe(false);
      expect(
        await database.select().from(relationshipSummaryVersion),
      ).toHaveLength(0);
      while (
        (await processAccountPurgeStage(database, requested.requestId, now)) ===
        "continue"
      ) {}
      if (kind === "summary")
        await processRelationshipSummaryRefresh(
          worker,
          gateway,
          extractionCounter,
          runId,
          new AbortController().signal,
        );
      else
        await processMemoryExtractionRun(
          worker,
          gateway,
          extractionCounter,
          runId,
          new AbortController().signal,
        );
      expect(calls).toBe(1);
      expect(await database.select().from(usageLedger)).toHaveLength(1);
      expect(await database.select().from(memoryItem)).toHaveLength(0);
    } finally {
      release.resolve();
      await Promise.allSettled([work, confirmation].filter(Boolean));
      await worker.$client.end();
      await confirmer.$client.end();
    }
  },
);

test("named PostgreSQL export snapshot holds publication before confirmation; confirmation then removes every archive byte", async () => {
  const owner = await summaryFixture(database);
  const requested = await request(owner.userId);
  const exported = await requestDataExport(database, {
    userId: owner.userId,
    now,
  });
  const entered = deferred();
  const release = deferred();
  const original = snapshotService.readDataExportSnapshot;
  vi.spyOn(snapshotService, "readDataExportSnapshot").mockImplementation(
    async (...args) => {
      const archive = await original(...args);
      entered.resolve();
      await release.promise;
      return archive;
    },
  );
  const confirmer = createDatabase(testDatabaseUrl(), {
    application_name: "deletion-export-snapshot-confirm",
  });
  const exporting = processDataExport(database, exported.exportId, now);
  let confirmation!: ReturnType<typeof confirmAccountDeletion>;
  try {
    await entered.promise;
    confirmation = confirmAccountDeletion(confirmer, {
      token: requested.verificationToken,
      now,
    });
    expect(
      await waitForExtractionLock(database, "deletion-export-snapshot-confirm"),
    ).toContain("chat_settings");
    release.resolve();
    await exporting;
    await confirmation;
    expect(await database.select().from(dataExportJob)).toHaveLength(0);
    expect(
      await downloadDataExport(database, {
        userId: owner.userId,
        exportId: exported.exportId,
        now,
      }),
    ).toBeNull();
  } finally {
    release.resolve();
    await Promise.allSettled([exporting, confirmation].filter(Boolean));
    await confirmer.$client.end();
  }
});
test("named PostgreSQL export snapshot/download queued behind confirmation cannot leave an archive or download", async () => {
  const owner = await summaryFixture(database);
  const requested = await request(owner.userId);
  const exported = await requestDataExport(database, {
    userId: owner.userId,
    now,
  });
  await processDataExport(database, exported.exportId, now);
  const contender = createDatabase(testDatabaseUrl(), {
    application_name: "deletion-export-race",
  });
  const confirmer = createDatabase(testDatabaseUrl(), {
    application_name: "deletion-download-confirm",
  });
  let confirmation!: ReturnType<typeof confirmAccountDeletion>;
  let downloading!: ReturnType<typeof downloadDataExport>;
  try {
    await database.transaction(async (tx) => {
      await tx
        .select()
        .from(user)
        .where(eq(user.id, owner.userId))
        .for("update");
      confirmation = confirmAccountDeletion(confirmer, {
        token: requested.verificationToken,
        now,
      });
      await waitForExtractionLock(database, "deletion-download-confirm");
      downloading = downloadDataExport(contender, {
        userId: owner.userId,
        exportId: exported.exportId,
        now,
      });
      expect(
        await waitForExtractionLock(database, "deletion-export-race"),
      ).toContain("chat_settings");
    });
    await confirmation;
    expect(await downloading).toBeNull();
    expect(
      await downloadDataExport(database, {
        userId: owner.userId,
        exportId: exported.exportId,
        now,
      }),
    ).toBeNull();
    expect(await database.select().from(dataExportJob)).toHaveLength(0);
    await processDataExport(database, exported.exportId, now);
    expect(await database.select().from(dataExportJob)).toHaveLength(0);
  } finally {
    await Promise.allSettled([confirmation, downloading].filter(Boolean));
    await contender.$client.end();
    await confirmer.$client.end();
  }
});

test.each(["extraction", "summary"] as const)(
  "in-flight %s response delivered after the final tombstone cannot recreate usage or private data",
  async (kind) => {
    const owner =
      kind === "summary"
        ? await summaryFixture(database)
        : await extractionFixture(database);
    let runId: string;
    let sourceMessageId = "";
    if (kind === "extraction") {
      const attempt = await extractionAttempt(database, owner);
      sourceMessageId = attempt.sourceMessageId;
      runId = (await database.transaction((tx) =>
        createExtractionRunForCompletedAttempt(tx, {
          ...owner,
          ...attempt,
          now,
        }),
      ))!.runId;
    } else
      runId = (owner as Awaited<ReturnType<typeof summaryFixture>>)
        .operationId!;
    const requested = await request(owner.userId);
    const entered = deferred();
    const release = deferred();
    const gateway = extractionGateway(async () => {
      entered.resolve();
      await release.promise;
      return kind === "summary"
        ? summaryResult("private-after-purge")
        : extractionResult([extractionCandidate(sourceMessageId)]);
    });
    const work =
      kind === "summary"
        ? processRelationshipSummaryRefresh(
            database,
            gateway,
            extractionCounter,
            runId,
            new AbortController().signal,
          )
        : processMemoryExtractionRun(
            database,
            gateway,
            extractionCounter,
            runId,
            new AbortController().signal,
          );
    try {
      await entered.promise;
      await confirmAccountDeletion(database, {
        token: requested.verificationToken,
        now,
      });
      while (
        (await processAccountPurgeStage(database, requested.requestId, now)) ===
        "continue"
      ) {}
      const before = await database.select().from(usageLedger);
      release.resolve();
      await work;
      expect(await database.select().from(usageLedger)).toEqual(before);
      expect(await database.select().from(memoryItem)).toHaveLength(0);
      expect(
        await database.select().from(relationshipSummaryVersion),
      ).toHaveLength(0);
      expect(await database.select().from(user)).toHaveLength(0);
    } finally {
      release.resolve();
      await Promise.allSettled([work]);
    }
  },
);
