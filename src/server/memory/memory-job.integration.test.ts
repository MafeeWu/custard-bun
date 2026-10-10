// @vitest-environment node
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  disableOrdinaryUser,
  restoreOrdinaryUser,
} from "@/server/admin/user-service";
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "@/server/db/client";
import {
  backgroundModelReservation,
  conversation,
  memoryExtractionRun,
  memoryItem,
  memoryExtractionExecution,
  memorySettings,
  quotaBucket,
  usageLedger,
  user,
  userCharacterMemorySetting,
} from "@/server/db/schema";
import { createConversationService } from "@/server/chat/conversation-service";
import { deleteUserWithGenerationSettlement } from "@/server/chat/quota-service";
import { ModelGatewayError } from "@/server/model-gateway/model-error";
import { testDatabaseUrl } from "@/test/database-target";
import {
  extractionAttempt,
  extractionCandidate,
  extractionCounter,
  extractionFixture,
  extractionGateway,
  extractionNow,
  extractionResult,
  resetExtractionDatabase,
  waitForExtractionLock,
} from "@/test/memory-extraction-fixture";
import { createExtractionRunForCompletedAttempt } from "./memory-extraction-service";
import {
  enqueuePendingExtractionRuns,
  lockExtractionRelationship,
  cancelRelationshipExtractions,
} from "./memory-extraction-service";
import { processMemoryExtractionRun } from "./memory-job";
import { forgetCharacter, updateMemoryControls } from "./memory-service";

const database = createDatabase(testDatabaseUrl());
beforeEach(() => resetExtractionDatabase(database));
afterAll(() => database.$client.end());
const signal = new AbortController().signal;

async function source() {
  const fixture = await extractionFixture(database);
  const attempt = await extractionAttempt(database, fixture);
  const run = await database.transaction((tx) =>
    createExtractionRunForCompletedAttempt(tx, {
      ...fixture,
      ...attempt,
      now: extractionNow,
    }),
  );
  return { ...fixture, ...attempt, runId: run!.runId };
}

async function recoveryReceipt(
  candidates: unknown,
  input: Awaited<ReturnType<typeof source>>,
) {
  await database.execute(
    sql.raw(`
    CREATE FUNCTION task5_fix_receipt_pause() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'pause after receipt'; END $$;
    CREATE TRIGGER task5_fix_receipt_pause BEFORE INSERT ON usage_ledger
    FOR EACH ROW EXECUTE FUNCTION task5_fix_receipt_pause()
  `),
  );
  try {
    await expect(
      processMemoryExtractionRun(
        database,
        extractionGateway(async () => extractionResult(candidates)),
        extractionCounter,
        input.runId,
        signal,
      ),
    ).rejects.toBeDefined();
    const [receipt] = await database.select().from(memoryExtractionExecution);
    expect(receipt.responseAt).toBeInstanceOf(Date);
    expect(receipt.settledAt).toBeNull();
    return receipt.candidates;
  } finally {
    await database.execute(
      sql.raw(
        "DROP TRIGGER task5_fix_receipt_pause ON usage_ledger; DROP FUNCTION task5_fix_receipt_pause()",
      ),
    );
  }
}

test.each([
  "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789_ABC",
  "sk-svcacct-abcdefghijklmnopqrstuvwxyz0123456789",
  "sk-abcdefghijklmnopqrstuvwxyz0123456789",
  ["sk", "live", "abcdefghijklmnopqrstuvwxyz"].join("_"),
  "sk-test-abcdefghijklmnopqrstuvwxyz",
  "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
  "github_pat_abcdefghijklmnopqrstuvwxyz0123456789",
  "AKIAIOSFODNN7EXAMPLE",
  "AIzaSyabcdefghijklmnopqrstuvwxyz0123456",
  ["xoxb", "123456789012-abcdefghijklmnopqrstuvwxyz"].join("-"),
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnopqrstuv",
  "Bearer abcdefghijklmnopqrstuvwxyz",
  "-----BEGIN RSA PRIVATE KEY----- abcdef -----END RSA PRIVATE KEY-----",
  "-----BEGIN OPENSSH PRIVATE KEY----- abcdef",
  "My recovery-code is AX91-BQ22",
  "My backup code is AX91-BQ22",
  "My seed phrase is alpha beta gamma",
  "My API key is live_abcdef123456",
  "My access token is abcdef123456",
  "My refresh_token is abcdef123456",
  "My password is hunter2",
  "My OTP is 654321",
  "4111 1111 1111 1111",
  "My bank login is private",
  "My credit card CVV is 123",
  "My token is abcdef123456",
  "My CVV is 123",
  "My passwd is hunter2",
  "My recovery phrase is alpha beta gamma",
])(
  "credential downgrade cannot reach a durable receipt: %s",
  async (content) => {
    const input = await source();
    const receipt = await recoveryReceipt(
      [
        extractionCandidate(input.sourceMessageId, { content }),
        extractionCandidate(input.sourceMessageId),
      ],
      input,
    );
    expect(receipt).toMatchObject([{ content: "Likes green tea." }]);
    expect(receipt).toHaveLength(1);
    await processMemoryExtractionRun(
      database,
      extractionGateway(async () => {
        throw new Error("Receipt replay must not call provider.");
      }),
      extractionCounter,
      input.runId,
      signal,
    );
    expect(await database.select().from(memoryItem)).toMatchObject([
      { content: "Likes green tea." },
    ]);
    expect(await database.select().from(usageLedger)).toHaveLength(1);
  },
);

test.each([
  ["Has type 1 diabetes.", "ordinary"],
  ["Has a medical diagnosis.", "ordinary"],
  ["Has HIV.", "ordinary"],
  ["Takes insulin for diabetes.", "ordinary"],
  ["Is Christian.", "ordinary"],
  ["Practices Islam.", "ordinary"],
  ["Is transgender.", "ordinary"],
  ["Is bisexual.", "ordinary"],
  ["Lives at 10 Main Street.", "ordinary"],
  ["Has type 1 diabetes.", "personal_explicit"],
  ["Has multiple sclerosis.", "ordinary"],
  ["Has a peanut allergy.", "ordinary"],
  ["Is Mormon.", "ordinary"],
  ["Identifies as Asian.", "ordinary"],
] as const)(
  "sensitive downgrade or unrelated consent cannot reach receipts: %s (%s)",
  async (content, sensitivity) => {
    const input = await source();
    const { conversationMessage } = await import("@/server/db/schema");
    await database
      .update(conversationMessage)
      .set({
        content:
          "Please remember that I prefer green tea. I have type 1 diabetes.",
      })
      .where(eq(conversationMessage.id, input.sourceMessageId));
    expect(
      await recoveryReceipt(
        [
          extractionCandidate(input.sourceMessageId, {
            type: "personal_fact",
            content,
            sensitivity,
            userExplicitlyAskedToRemember: true,
          }),
        ],
        input,
      ),
    ).toEqual([]);
  },
);

test("candidate-specific consent upgrades provider downgrades and ignores its false intent hint", async () => {
  const input = await source();
  const { conversationMessage } = await import("@/server/db/schema");
  await database
    .update(conversationMessage)
    .set({
      content: "Please remember that I have type 1 diabetes.",
    })
    .where(eq(conversationMessage.id, input.sourceMessageId));
  expect(
    await recoveryReceipt(
      [
        extractionCandidate(input.sourceMessageId, {
          type: "personal_fact",
          content: "Has type 1 diabetes.",
          sensitivity: "ordinary",
          userExplicitlyAskedToRemember: false,
        }),
      ],
      input,
    ),
  ).toMatchObject([
    {
      content: "Has type 1 diabetes.",
      sensitivity: "personal_explicit",
      userExplicitlyAskedToRemember: true,
    },
  ]);
});

test.each([
  "Please remember that I do not have type 1 diabetes.",
  "Please remember my tea preference; I have type 1 diabetes.",
  "Please remember my tea preference, but I have type 1 diabetes.",
])(
  "a negated or nonrequested diagnosis is not candidate-specific consent: %s",
  async (content) => {
    const input = await source();
    const { conversationMessage } = await import("@/server/db/schema");
    await database
      .update(conversationMessage)
      .set({ content })
      .where(eq(conversationMessage.id, input.sourceMessageId));
    expect(
      await recoveryReceipt(
        [
          extractionCandidate(input.sourceMessageId, {
            content: "Has type 1 diabetes.",
            sensitivity: "personal_explicit",
            userExplicitlyAskedToRemember: true,
          }),
        ],
        input,
      ),
    ).toEqual([]);
  },
);

test("receipts persist only canonical NFKC and collapsed whitespace content", async () => {
  const input = await source();
  expect(
    await recoveryReceipt(
      [
        extractionCandidate(input.sourceMessageId, {
          content: "  Ｌｉｋｅｓ\tgreen\n  tea.  ",
        }),
      ],
      input,
    ),
  ).toMatchObject([{ content: "Likes green tea." }]);
});

test("duplicate concurrent deliveries make one call item evidence and instance-only settlement", async () => {
  const input = await source();
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let calls = 0;
  const gateway = extractionGateway(async () => {
    calls++;
    entered();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return extractionResult([extractionCandidate(input.sourceMessageId)]);
  });
  const work = processMemoryExtractionRun(
    database,
    gateway,
    extractionCounter,
    input.runId,
    signal,
  );
  await started;
  await processMemoryExtractionRun(
    database,
    gateway,
    extractionCounter,
    input.runId,
    signal,
  );
  release();
  await work;
  await processMemoryExtractionRun(
    database,
    gateway,
    extractionCounter,
    input.runId,
    signal,
  );
  expect(calls).toBe(1);
  expect(await database.select().from(memoryItem)).toHaveLength(1);
  const ledger = await database.select().from(usageLedger);
  expect(ledger).toMatchObject([
    {
      workloadType: "memory_extraction",
      userRequestUnits: 0,
      inputTokens: 13,
      outputTokens: 7,
    },
  ]);
  expect(await database.select().from(quotaBucket)).toMatchObject([
    {
      scope: "instance",
      reservedRequests: 0,
      consumedRequests: 0,
      consumedTokens: 20,
      reservedTokens: 0,
    },
  ]);
  expect(
    (await database.select().from(backgroundModelReservation))[0].settledAt,
  ).not.toBeNull();
  expect((await database.select().from(memoryExtractionRun))[0]).toMatchObject({
    status: "complete",
    attemptCount: 1,
  });
});

test.each([
  "delete",
  "forget",
  "recording-disable",
  "global-disable",
  "banned",
  "account-lockout",
] as const)(
  "%s between provider response and apply rejects stale content and settles once",
  async (kind) => {
    const input = await source();
    const gateway = extractionGateway(async () => {
      if (kind === "delete")
        await createConversationService(database).delete(input);
      if (kind === "forget")
        await forgetCharacter(database, { ...input, expectedRevision: 1 });
      if (kind === "recording-disable")
        await updateMemoryControls(database, {
          ...input,
          expectedRevision: 1,
          recordingEnabled: false,
          usageEnabled: true,
        });
      if (kind === "global-disable")
        await database.update(memorySettings).set({ enabled: false });
      if (kind === "banned")
        await database
          .update(user)
          .set({ banned: true })
          .where(eq(user.id, input.userId));
      if (kind === "account-lockout")
        await database
          .update(user)
          .set({ deletionPendingAt: new Date() })
          .where(eq(user.id, input.userId));
      return extractionResult([extractionCandidate(input.sourceMessageId)]);
    });
    await processMemoryExtractionRun(
      database,
      gateway,
      extractionCounter,
      input.runId,
      signal,
    );
    await processMemoryExtractionRun(
      database,
      gateway,
      extractionCounter,
      input.runId,
      signal,
    );
    expect(await database.select().from(memoryItem)).toHaveLength(0);
    expect(await database.select().from(usageLedger)).toMatchObject([
      { outcome: "cancelled", inputTokens: 13, outputTokens: 7 },
    ]);
    expect((await database.select().from(memoryExtractionRun))[0].status).toBe(
      "cancelled",
    );
    if (kind === "delete")
      expect(await database.select().from(conversation)).toHaveLength(0);
  },
);

test("five executions means initial plus four retries with durable exponential due times", async () => {
  const input = await source();
  const gateway = extractionGateway(async () => {
    throw new ModelGatewayError("server", { retryable: true });
  });
  for (let count = 1; count <= 5; count++) {
    if (count > 1)
      await database
        .update(memoryExtractionRun)
        .set({ nextRetryAt: new Date(0) });
    await expect(
      processMemoryExtractionRun(
        database,
        gateway,
        extractionCounter,
        input.runId,
        signal,
      ),
    ).rejects.toMatchObject({ category: "server" });
    const run = (await database.select().from(memoryExtractionRun))[0];
    expect(run.attemptCount).toBe(count);
    expect(run.status).toBe(count < 5 ? "retrying" : "dead_letter");
    if (count < 5)
      expect(run.nextRetryAt!.getTime() - run.updatedAt.getTime()).toBe(
        60_000 * 2 ** (count - 1),
      );
  }
  await processMemoryExtractionRun(
    database,
    gateway,
    extractionCounter,
    input.runId,
    signal,
  );
  expect(await database.select().from(usageLedger)).toHaveLength(5);
  expect((await database.select().from(quotaBucket))[0].reservedTokens).toBe(0);
});

test("invalid provider JSON fails safely, settles the response, and persists no candidates or request identities", async () => {
  const input = await source();
  const complete = vi.fn(async () =>
    extractionResult([{ secret: "provider secret value" }]),
  );
  await expect(
    processMemoryExtractionRun(
      database,
      extractionGateway(complete),
      extractionCounter,
      input.runId,
      signal,
    ),
  ).rejects.toMatchObject({ code: "MEMORY_VALIDATION" });
  expect(await database.select().from(memoryItem)).toHaveLength(0);
  const run = (await database.select().from(memoryExtractionRun))[0];
  expect(run.status).toBe("failed");
  expect(JSON.stringify(run)).not.toContain("secret value");
  expect(JSON.stringify(run)).not.toContain("private-provider-request-id");
  expect(await database.select().from(usageLedger)).toHaveLength(1);
});

test("preclaim cancellation calls no provider and reserves nothing", async () => {
  const input = await source();
  await database
    .delete(conversation)
    .where(eq(conversation.id, input.conversationId));
  const complete = vi.fn(async () => extractionResult([]));
  await processMemoryExtractionRun(
    database,
    extractionGateway(complete),
    extractionCounter,
    input.runId,
    signal,
  );
  expect(complete).not.toHaveBeenCalled();
  expect(await database.select().from(backgroundModelReservation)).toHaveLength(
    0,
  );
  expect((await database.select().from(memoryExtractionRun))[0].status).toBe(
    "cancelled",
  );
});

test("legacy hard deletion settles a running extraction before erasing its durable recovery rows", async () => {
  const input = await source();
  let settledBeforeReply: Date | null | undefined;
  const gateway = extractionGateway(async () => {
    await deleteUserWithGenerationSettlement(
      database,
      input.userId,
      new Date(),
    );
    settledBeforeReply = (
      await database.select().from(backgroundModelReservation)
    )[0].settledAt;
    return extractionResult([extractionCandidate(input.sourceMessageId)]);
  });
  await processMemoryExtractionRun(
    database,
    gateway,
    extractionCounter,
    input.runId,
    signal,
  );
  expect(settledBeforeReply).toBeInstanceOf(Date);
  expect(await database.select().from(user)).toHaveLength(0);
  expect(await database.select().from(memoryExtractionRun)).toHaveLength(0);
  expect(await database.select().from(memoryItem)).toHaveLength(0);
  expect(await database.select().from(usageLedger)).toHaveLength(1);
  expect((await database.select().from(quotaBucket))[0].reservedTokens).toBe(0);
});

test("database failure during apply preserves a durable receipt and retry never recalls or double-charges the provider", async () => {
  const input = await source();
  const complete = vi.fn(async () =>
    extractionResult([extractionCandidate(input.sourceMessageId)]),
  );
  const gateway = extractionGateway(complete);
  await database.execute(
    sql.raw(`
    CREATE FUNCTION task5_fail_merge() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'injected merge failure'; END $$;
    CREATE TRIGGER task5_fail_merge BEFORE INSERT ON memory_items
    FOR EACH ROW EXECUTE FUNCTION task5_fail_merge()
  `),
  );
  try {
    await expect(
      processMemoryExtractionRun(
        database,
        gateway,
        extractionCounter,
        input.runId,
        signal,
      ),
    ).rejects.toBeDefined();
    expect(await database.select().from(usageLedger)).toHaveLength(0);
    expect(
      (await database.select().from(memoryExtractionExecution))[0].responseAt,
    ).not.toBeNull();
  } finally {
    await database.execute(
      sql.raw(
        "DROP TRIGGER task5_fail_merge ON memory_items; DROP FUNCTION task5_fail_merge()",
      ),
    );
  }
  await processMemoryExtractionRun(
    database,
    gateway,
    extractionCounter,
    input.runId,
    signal,
  );
  expect(complete).toHaveBeenCalledTimes(1);
  expect(await database.select().from(memoryItem)).toHaveLength(1);
  expect(await database.select().from(usageLedger)).toHaveLength(1);
  expect(
    (await database.select().from(memoryExtractionExecution))[0],
  ).toMatchObject({ candidates: null, settledAt: expect.any(Date) });
});

test("expired crash claim is fenced and conservatively settled once before a new execution", async () => {
  const input = await source();
  const complete = vi.fn(async () => extractionResult([]));
  await database.transaction(async (tx) => {
    const { admitBackgroundModelWork } =
      await import("./background-usage-service");
    await admitBackgroundModelWork(tx, {
      userId: input.userId,
      operationId: "crashed-extraction",
      workloadType: "memory_extraction",
      estimatedTokens: 4196,
      now: extractionNow,
    });
    await tx.insert(memoryExtractionExecution).values({
      id: "crashed-extraction",
      runId: input.runId,
      executionNumber: 1,
      modelId: "test-model",
      estimatedInputTokens: 100,
    });
    await tx.update(memoryExtractionRun).set({
      status: "running",
      attemptCount: 1,
      claimToken: "lost-worker",
      startedAt: extractionNow,
      leaseExpiresAt: extractionNow,
    });
  });
  await expect(
    processMemoryExtractionRun(
      database,
      extractionGateway(complete),
      extractionCounter,
      input.runId,
      signal,
    ),
  ).rejects.toMatchObject({ retryable: true });
  expect(complete).not.toHaveBeenCalled();
  expect(await database.select().from(usageLedger)).toMatchObject([
    { usageIsEstimated: true, inputTokens: 100, outputTokens: 4096 },
  ]);
  await database.update(memoryExtractionRun).set({ nextRetryAt: new Date(0) });
  await processMemoryExtractionRun(
    database,
    extractionGateway(complete),
    extractionCounter,
    input.runId,
    signal,
  );
  expect(complete).toHaveBeenCalledTimes(1);
  expect(await database.select().from(usageLedger)).toHaveLength(2);
  expect((await database.select().from(memoryExtractionRun))[0]).toMatchObject({
    status: "complete",
    attemptCount: 2,
  });
});

test("startup reconciliation recovers an abandoned cancelled claim and releases its reservation", async () => {
  const input = await source();
  await database.transaction(async (tx) => {
    const { admitBackgroundModelWork } =
      await import("./background-usage-service");
    await admitBackgroundModelWork(tx, {
      userId: input.userId,
      operationId: "forgotten-crash",
      workloadType: "memory_extraction",
      estimatedTokens: 4196,
      now: extractionNow,
    });
    await tx.insert(memoryExtractionExecution).values({
      id: "forgotten-crash",
      runId: input.runId,
      executionNumber: 1,
      modelId: "test-model",
      estimatedInputTokens: 100,
    });
    await tx.update(memoryExtractionRun).set({
      status: "running",
      attemptCount: 1,
      claimToken: "lost-worker",
      leaseExpiresAt: extractionNow,
    });
  });
  await forgetCharacter(database, { ...input, expectedRevision: 1 });
  const send = vi
    .fn<(...args: unknown[]) => Promise<string | null>>()
    .mockResolvedValue("recovery-job");
  expect(
    await enqueuePendingExtractionRuns(database, { send }, new Date()),
  ).toBe(1);
  await processMemoryExtractionRun(
    database,
    extractionGateway(async () => extractionResult([])),
    extractionCounter,
    input.runId,
    signal,
  );
  expect((await database.select().from(quotaBucket))[0].reservedTokens).toBe(0);
  expect(await database.select().from(usageLedger)).toMatchObject([
    { outcome: "cancelled" },
  ]);
});

test("disable then reenable recording while the provider runs cannot resurrect that extraction", async () => {
  const input = await source();
  const gateway = extractionGateway(async () => {
    await updateMemoryControls(database, {
      ...input,
      expectedRevision: 1,
      recordingEnabled: false,
      usageEnabled: true,
    });
    await updateMemoryControls(database, {
      ...input,
      expectedRevision: 2,
      recordingEnabled: true,
      usageEnabled: true,
    });
    return extractionResult([extractionCandidate(input.sourceMessageId)]);
  });
  await processMemoryExtractionRun(
    database,
    gateway,
    extractionCounter,
    input.runId,
    signal,
  );
  expect(await database.select().from(memoryItem)).toHaveLength(0);
  expect((await database.select().from(memoryExtractionRun))[0].status).toBe(
    "cancelled",
  );
});

test("instance budget denial is durable and never charges a user bucket", async () => {
  const input = await source();
  const { chatSettings } = await import("@/server/db/schema");
  await database.update(chatSettings).set({ instanceMonthlyTokenBudget: 1 });
  const complete = vi.fn(async () => extractionResult([]));
  await expect(
    processMemoryExtractionRun(
      database,
      extractionGateway(complete),
      extractionCounter,
      input.runId,
      signal,
    ),
  ).rejects.toMatchObject({ code: "CHAT_INSTANCE_TOKEN_BUDGET" });
  expect(complete).not.toHaveBeenCalled();
  expect((await database.select().from(memoryExtractionRun))[0]).toMatchObject({
    status: "retrying",
    attemptCount: 1,
    errorCategory: "instance_budget",
  });
  expect(await database.select().from(usageLedger)).toHaveLength(0);
  expect(
    await database
      .select()
      .from(quotaBucket)
      .where(eq(quotaBucket.scope, "user")),
  ).toHaveLength(0);
  expect(await database.select().from(backgroundModelReservation)).toHaveLength(
    0,
  );
});

test("explicit personal memory is allowed only with direct remember intent and no repeated inference", async () => {
  const input = await source();
  const { conversationMessage } = await import("@/server/db/schema");
  await database
    .update(conversationMessage)
    .set({ content: "Please remember my diagnosis." })
    .where(eq(conversationMessage.id, input.sourceMessageId));
  await processMemoryExtractionRun(
    database,
    extractionGateway(async () =>
      extractionResult([
        extractionCandidate(input.sourceMessageId, {
          content: "Has a medical diagnosis.",
          type: "personal_fact",
          sensitivity: "personal_explicit",
          userExplicitlyAskedToRemember: true,
        }),
        extractionCandidate(input.sourceMessageId, {
          content: "Medical inferred fact.",
          sensitivity: "personal_explicit",
          userExplicitlyAskedToRemember: true,
          explicitness: "repeated_inference",
        }),
      ]),
    ),
    extractionCounter,
    input.runId,
    signal,
  );
  expect(await database.select().from(memoryItem)).toMatchObject([
    { content: "Has a medical diagnosis.", sensitivity: "personal_explicit" },
  ]);
  expect(
    (await database.select().from(userCharacterMemorySetting))[0]
      .memoryRevision,
  ).toBe(1);
});

test("structured extraction uses a strict provider-compatible object envelope and only the current turn", async () => {
  const input = await source();
  let schemaType: unknown;
  const gateway = extractionGateway(async (request) => {
    schemaType = request.jsonSchema.type;
    expect(request.messages).toHaveLength(2);
    expect(request.messages[1].content).toContain(input.sourceMessageId);
    expect(request.messages[1].content).not.toContain("Hello.");
    return extractionResult([extractionCandidate(input.sourceMessageId)]);
  });
  await processMemoryExtractionRun(
    database,
    gateway,
    extractionCounter,
    input.runId,
    signal,
  );
  expect(schemaType).toBe("object");
  expect(await database.select().from(memoryItem)).toHaveLength(1);
});

test.each(["delete", "forget", "recording-disable", "lockout"] as const)(
  "named separate-connection %s race fences a ready provider response behind canonical settings locks",
  async (kind) => {
    const input = await source();
    const writerName = `task5-${kind}-provider-apply`;
    const writer = createDatabase(testDatabaseUrl(), {
      application_name: writerName,
      max: 1,
    });
    const mutator = createDatabase(testDatabaseUrl(), {
      application_name: `task5-${kind}-mutation`,
      max: 1,
    });
    let releaseProvider!: () => void;
    let providerEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      providerEntered = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    let releaseMutation!: () => void;
    let mutationEntered!: () => void;
    const mutationStarted = new Promise<void>((resolve) => {
      mutationEntered = resolve;
    });
    const mutationDone = new Promise<void>((resolve) => {
      releaseMutation = resolve;
    });
    const gateway = extractionGateway(async () => {
      providerEntered();
      await ready;
      return extractionResult([extractionCandidate(input.sourceMessageId)]);
    });
    const work = processMemoryExtractionRun(
      writer,
      gateway,
      extractionCounter,
      input.runId,
      signal,
    );
    let mutation: Promise<void> | undefined;
    try {
      await entered;
      mutation = mutator.transaction(async (tx) => {
        await lockExtractionRelationship(tx, input);
        if (kind === "delete")
          await tx
            .delete(conversation)
            .where(eq(conversation.id, input.conversationId));
        if (kind === "forget") {
          await tx
            .update(userCharacterMemorySetting)
            .set({ memoryEpoch: 1, revision: 2 });
          await cancelRelationshipExtractions(tx, input, new Date());
        }
        if (kind === "recording-disable") {
          await tx
            .update(userCharacterMemorySetting)
            .set({ recordingEnabled: false, revision: 2 });
          await cancelRelationshipExtractions(tx, input, new Date());
        }
        if (kind === "lockout")
          await tx
            .update(user)
            .set({ deletionPendingAt: new Date() })
            .where(eq(user.id, input.userId));
        mutationEntered();
        await mutationDone;
      });
      await mutationStarted;
      releaseProvider();
      expect(await waitForExtractionLock(database, writerName)).toMatch(
        /chat_settings/,
      );
      releaseMutation();
      await mutation;
      await work;
      expect(await database.select().from(memoryItem)).toHaveLength(0);
      expect(await database.select().from(usageLedger)).toMatchObject([
        { outcome: "cancelled", inputTokens: 13, outputTokens: 7 },
      ]);
      expect(
        (await database.select().from(memoryExtractionExecution))[0].candidates,
      ).toBeNull();
    } finally {
      releaseProvider();
      releaseMutation();
      await Promise.allSettled([work, mutation].filter(Boolean));
      await writer.$client.end();
      await mutator.$client.end();
    }
  },
);

test("global disable then reenable cannot resurrect a provider result from before disable", async () => {
  const input = await source();
  const gateway = extractionGateway(async () => {
    await database.update(memorySettings).set({ enabled: false });
    await database.update(memorySettings).set({ enabled: true });
    return extractionResult([extractionCandidate(input.sourceMessageId)]);
  });
  await processMemoryExtractionRun(
    database,
    gateway,
    extractionCounter,
    input.runId,
    signal,
  );
  expect(await database.select().from(memoryItem)).toHaveLength(0);
  expect((await database.select().from(memoryExtractionRun))[0].status).toBe(
    "cancelled",
  );
});

test("actual administrator disable then restore cannot resurrect in-flight extraction", async () => {
  const input = await source();
  const adminId = randomUUID();
  await database.insert(user).values({
    id: adminId,
    email: `${adminId}@example.com`,
    name: "Administrator",
    role: "admin",
    emailVerified: true,
  });
  const actor = {
    userId: adminId,
    label: "Administrator",
    operationId: randomUUID(),
  };
  const gateway = extractionGateway(async () => {
    await disableOrdinaryUser(database, actor, {
      userId: input.userId,
      reason: "Test lockout",
    });
    await restoreOrdinaryUser(
      database,
      { ...actor, operationId: randomUUID() },
      { userId: input.userId },
    );
    return extractionResult([extractionCandidate(input.sourceMessageId)]);
  });
  await processMemoryExtractionRun(
    database,
    gateway,
    extractionCounter,
    input.runId,
    signal,
  );
  expect(await database.select().from(memoryItem)).toHaveLength(0);
  expect((await database.select().from(memoryExtractionRun))[0].status).toBe(
    "cancelled",
  );
});
