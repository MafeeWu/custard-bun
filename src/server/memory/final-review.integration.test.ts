// @vitest-environment node
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "@/server/db/client";
import {
  generationAttempt,
  memoryExtractionExecution,
  memoryItem,
  relationshipSummaryExecution,
  relationshipSummaryVersion,
  usageLedger,
} from "@/server/db/schema";
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
import { summaryResult } from "@/test/memory-summary-fixture";
import { createExtractionRunForCompletedAttempt } from "./memory-extraction-service";
import { mergeMemoryCandidates } from "./memory-merge-service";
import { processMemoryExtractionRun } from "./memory-job";
import {
  deleteMemoryItem,
  editMemoryItem,
  updateMemoryControls,
} from "./memory-service";
import {
  DEFAULT_RELATIONSHIP_SUMMARY_POLICY,
  editRelationshipSummary,
  ensureAutomaticSummaryRefresh,
  getRelationshipSummary,
} from "./relationship-summary-service";
import { processRelationshipSummaryRefresh } from "./relationship-summary-job";
import { loadMemoryContext } from "./memory-recall";
import * as runtimeConfig from "@/server/config/load-config";

const database = createDatabase(testDatabaseUrl());
const signal = new AbortController().signal;
const limits = { maxActiveItemsPerCharacter: 1, maxItemCharacters: 20 };
beforeEach(() => resetExtractionDatabase(database));
afterAll(() => database.$client.end());

async function source(userContent = "I prefer green tea.") {
  const scope = await extractionFixture(database);
  return nextSource(scope, 1, userContent);
}

async function nextSource(
  scope: Awaited<ReturnType<typeof extractionFixture>>,
  sequence: number,
  userContent = "I prefer green tea.",
) {
  const attempt = await extractionAttempt(
    database,
    scope,
    sequence,
    userContent,
  );
  const run = await database.transaction((tx) =>
    createExtractionRunForCompletedAttempt(tx, {
      ...scope,
      ...attempt,
      now: extractionNow,
    }),
  );
  return { ...scope, ...attempt, runId: run!.runId };
}

async function merge(
  input: Awaited<ReturnType<typeof source>>,
  content = "Likes green tea.",
  options: {
    inferred?: boolean;
    configured?: boolean;
    executor?: typeof database;
  } = {},
) {
  // The optional policy is the same deployment policy used by the production writer.
  const execute = mergeMemoryCandidates as unknown as (
    tx: Parameters<typeof mergeMemoryCandidates>[0],
    input: Parameters<typeof mergeMemoryCandidates>[1],
    policy?: typeof limits,
  ) => ReturnType<typeof mergeMemoryCandidates>;
  return (options.executor ?? database).transaction((tx) =>
    execute(
      tx,
      {
        runId: input.runId,
        now: extractionNow,
        candidates: [
          extractionCandidate(input.sourceMessageId, {
            content,
            explicitness: options.inferred ? "repeated_inference" : "direct",
          }),
        ],
      },
      options.configured ? limits : undefined,
    ),
  );
}

async function refresh(
  input: Awaited<ReturnType<typeof source>>,
  content: string,
) {
  const run = await database.transaction((tx) =>
    ensureAutomaticSummaryRefresh(tx, input),
  );
  await processRelationshipSummaryRefresh(
    database,
    extractionGateway(async () => summaryResult(content)),
    extractionCounter,
    run!.operationId,
    signal,
  );
}

async function recall(input: Awaited<ReturnType<typeof source>>) {
  return loadMemoryContext(database, {
    ...input,
    summaryTokenBudget: 512,
    itemTokenBudget: 1536,
    tokenCounter: extractionCounter,
  });
}

test.each([
  ["Remember my passcode is 654321.", "654321"],
  ["Remember my password is bluebird.", "bluebird"],
  ["Remember my OTP is 829174.", "829174"],
  ["Remember my recovery code is sunrise-42.", "sunrise-42"],
  ["Remember my API key is orchard-secret.", "orchard-secret"],
  ["Remember my bank PIN is 2468.", "2468"],
  ["Remember my session token is blue-mountain.", "blue-mountain"],
  ["Remember my MFA code is 735291.", "735291"],
  ["Remember my two-factor authentication code is 749152.", "749152"],
  ["Remember my PIN is 3619.", "3619"],
])(
  "F1 rejects label-stripped credentials before receipt: %s",
  async (userContent, content) => {
    const input = await source(userContent);
    // Interrupt settlement, leaving the real durable response receipt observable.
    await database.execute(
      sql.raw(`
    CREATE FUNCTION final_fix_pause() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'controlled settlement pause'; END $$;
    CREATE TRIGGER final_fix_pause BEFORE INSERT ON usage_ledger
    FOR EACH ROW EXECUTE FUNCTION final_fix_pause()
  `),
    );
    try {
      await expect(
        processMemoryExtractionRun(
          database,
          extractionGateway(async () =>
            extractionResult([
              extractionCandidate(input.sourceMessageId, { content }),
            ]),
          ),
          extractionCounter,
          input.runId,
          signal,
        ),
      ).rejects.toBeDefined();
      expect(
        (await database.select().from(memoryExtractionExecution))[0].candidates,
      ).toEqual([]);
    } finally {
      await database.execute(
        sql.raw(
          "DROP TRIGGER final_fix_pause ON usage_ledger; DROP FUNCTION final_fix_pause()",
        ),
      );
    }
    await merge(input, content);
    expect(await database.select().from(memoryItem)).toEqual([]);
  },
);

test("F1 does not reject arbitrary ordinary numbers", async () => {
  const input = await source("My favorite number is 654321.");
  await merge(input, "Favorite number is 654321.");
  expect((await database.select().from(memoryItem))[0].content).toBe(
    "Favorite number is 654321.",
  );
});

test("F2 unauthorized compound sensitive summary never reaches a recovery receipt", async () => {
  const input = await source();
  await merge(input);
  await database.execute(
    sql.raw(`
    CREATE FUNCTION final_fix_pause() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'controlled settlement pause'; END $$;
    CREATE TRIGGER final_fix_pause BEFORE INSERT ON usage_ledger
    FOR EACH ROW EXECUTE FUNCTION final_fix_pause()
  `),
  );
  try {
    await expect(
      refresh(input, "The user has HIV and is Muslim."),
    ).rejects.toBeDefined();
    expect(
      (await database.select().from(relationshipSummaryExecution))[0],
    ).toMatchObject({
      summary: null,
      errorCategory: "validation",
    });
  } finally {
    await database.execute(
      sql.raw(
        "DROP TRIGGER final_fix_pause ON usage_ledger; DROP FUNCTION final_fix_pause()",
      ),
    );
  }
  expect(await database.select().from(relationshipSummaryVersion)).toEqual([]);
});

test("F2 validates every fact, not just an authorized sensitive topic", async () => {
  const input = await source("Remember I have HIV.");
  await merge(input, "Has HIV.");
  await expect(
    refresh(input, "The user has HIV and is Muslim."),
  ).rejects.toMatchObject({ code: "MEMORY_VALIDATION" });
  expect(await getRelationshipSummary(database, input)).toBeNull();
  expect(await database.select().from(usageLedger)).toHaveLength(1);
});

test("F2 permits current explicitly authorized sensitive facts and user-authored summaries", async () => {
  const input = await source("Remember I have HIV.");
  await merge(input, "Has HIV.");
  await refresh(input, "The user has HIV.");
  expect((await getRelationshipSummary(database, input))!.content).toBe(
    "The user has HIV.",
  );
  await editRelationshipSummary(
    database,
    {
      ...input,
      content: "The user is Muslim.",
      expectedRevision: 1,
      expectedMemoryEpoch: 0,
      userExplicitlyAskedToRemember: true,
    },
    DEFAULT_RELATIONSHIP_SUMMARY_POLICY,
  );
  expect((await getRelationshipSummary(database, input))!.origin).toBe(
    "user_edited",
  );
});

test("F2 ordinary memory labels cannot authorize sensitive summaries", async () => {
  const input = await source();
  await merge(input);
  const ordinary = (await database.select().from(memoryItem))[0];
  await database
    .update(memoryItem)
    .set({
      content: "Has HIV.",
      normalizedContent: "Has HIV.",
    })
    .where(eq(memoryItem.id, ordinary.id));
  await expect(refresh(input, "Has HIV.")).rejects.toMatchObject({
    code: "MEMORY_VALIDATION",
  });
});

test("F2 inactive sensitive memories cannot authorize summaries", async () => {
    const input = await source("Remember I have HIV.");
    await merge(input, "Has HIV.");
    const sensitive = (await database.select().from(memoryItem))[0];
    const second = await nextSource(input, 3);
    await merge(second);
    await database.update(memoryItem).set({ isActive: false })
      .where(eq(memoryItem.id, sensitive.id));
    await expect(refresh(input, "Has HIV.")).rejects.toMatchObject({ code: "MEMORY_VALIDATION" });
});

test("F3 deletion fences admitted work, completion and replay without deleting retained facts", async () => {
  const input = await source();
  await merge(input);
  const retained = await nextSource(input, 3);
  await merge(retained, "Likes mint tea.");
  const stale = await nextSource(input, 5);
  const unfinished = await extractionAttempt(
    database,
    input,
    7,
    "I prefer green tea.",
    "streaming",
  );
  const deleted = (await database.select().from(memoryItem)).find(
    (item) => item.content === "Likes green tea.",
  )!;
  await deleteMemoryItem(database, { ...input, memoryId: deleted.id });
  expect((await merge(stale)).applied).toBe(false);
  expect(
    (
      await database
        .select()
        .from(generationAttempt)
        .where(eq(generationAttempt.id, unfinished.attemptId))
    )[0].extractionMemoryEpoch,
  ).toBeNull();
  await database
    .update(generationAttempt)
    .set({ status: "complete", completedAt: extractionNow })
    .where(eq(generationAttempt.id, unfinished.attemptId));
  expect(
    await database.transaction((tx) =>
      createExtractionRunForCompletedAttempt(tx, {
        ...input,
        attemptId: unfinished.attemptId,
        now: extractionNow,
      }),
    ),
  ).toBeNull();
  expect(
    (await database.select().from(memoryItem)).map((item) => item.content),
  ).toEqual(["Likes mint tea."]);
  const fresh = await nextSource(input, 9);
  expect((await merge(fresh, "Likes jasmine tea.")).applied).toBe(true);
});

test.each(["automatic", "user_edited"] as const)(
  "F4 delete invalidates %s summary even with recording disabled and regenerates remaining facts only",
  async (origin) => {
    const input = await source();
    await merge(input);
    const second = await nextSource(input, 3);
    await merge(second, "Likes mint tea.");
    if (origin === "automatic")
      await refresh(input, "Likes green tea. Likes mint tea.");
    else
      await editRelationshipSummary(
        database,
        {
          ...input,
          expectedRevision: 0,
          expectedMemoryEpoch: 0,
          content: "Likes green tea. Likes mint tea.",
          userExplicitlyAskedToRemember: true,
        },
        DEFAULT_RELATIONSHIP_SUMMARY_POLICY,
      );
    await updateMemoryControls(database, {
      ...input,
      expectedRevision: 1,
      recordingEnabled: false,
      usageEnabled: true,
    });
    const deleted = (await database.select().from(memoryItem)).find(
      (item) => item.content === "Likes green tea.",
    )!;
    await deleteMemoryItem(database, { ...input, memoryId: deleted.id });
    expect((await recall(input)).summary).toBeUndefined();
    await updateMemoryControls(database, {
      ...input,
      expectedRevision: 2,
      recordingEnabled: true,
      usageEnabled: true,
    });
    const run = await database.transaction((tx) =>
      ensureAutomaticSummaryRefresh(tx, input),
    );
    await processRelationshipSummaryRefresh(
      database,
      extractionGateway(async (request) => {
        const supplied = JSON.parse(request.messages[1].content);
        expect(supplied.priorAutomaticSummary).toBeNull();
        expect(JSON.stringify(supplied)).not.toContain("green tea");
        return summaryResult("Likes mint tea.");
      }),
      extractionCounter,
      run!.operationId,
      signal,
    );
    expect((await recall(input)).summary!.content).toBe("Likes mint tea.");
  },
);

test("F5 configured item length applies to automatic normalization and manual edits", async () => {
  const input = await source();
  await merge(input, "a".repeat(21), { configured: true });
  expect(await database.select().from(memoryItem)).toEqual([]);
  await merge(input, "a".repeat(20), { configured: true });
  const item = (await database.select().from(memoryItem))[0];
  const edit = editMemoryItem as unknown as (
    db: typeof database,
    input: Parameters<typeof editMemoryItem>[1],
    policy: typeof limits,
  ) => ReturnType<typeof editMemoryItem>;
  await expect(
    edit(
      database,
      {
        ...input,
        memoryId: item.id,
        expectedRevision: item.revision,
        content: "b".repeat(21),
      },
      limits,
    ),
  ).rejects.toMatchObject({ code: "MEMORY_VALIDATION" });
  await edit(
    database,
    {
      ...input,
      memoryId: item.id,
      expectedRevision: item.revision,
      content: "b".repeat(20),
    },
    limits,
  );
  expect((await database.select().from(memoryItem))[0].content).toBe(
    "b".repeat(20),
  );
});

test("F5 NFKC expansion respects configured item length before extraction receipts", async () => {
  const input = await source();
  await merge(input, "ﬀ".repeat(11), { configured: true });
  expect(await database.select().from(memoryItem)).toEqual([]);
  await merge(input, "ﬀ".repeat(10), { configured: true });
  expect((await database.select().from(memoryItem))[0].content).toBe(
    "f".repeat(20),
  );
});

test("F5 deployed configured limit filters worker receipts before replay and merge", async () => {
  const config = await runtimeConfig.getRuntimeConfig();
  const spy = vi.spyOn(runtimeConfig, "getRuntimeConfig").mockResolvedValue({
    ...config, public: {
      ...config.public, memory: { ...config.public.memory, ...limits },
    },
  });
  try {
    const input = await source();
    await processMemoryExtractionRun(database, extractionGateway(async () => extractionResult([
      extractionCandidate(input.sourceMessageId, { content: "ﬀ".repeat(11) }),
      extractionCandidate(input.sourceMessageId, { content: "a".repeat(20) }),
    ])), extractionCounter, input.runId, signal);
    expect((await database.select().from(memoryItem)).map((item) => item.content)).toEqual(["a".repeat(20)]);
    expect(await database.select().from(usageLedger)).toHaveLength(1);
  } finally {
    spy.mockRestore();
  }
});

test("F5 manual inferred activation cannot exceed capacity", async () => {
  const input = await source();
  await merge(input, "Likes green tea.", { configured: true });
  const second = await nextSource(input, 3);
  await merge(second, "Likes mint tea.", { inferred: true, configured: true });
  const inactive = (await database.select().from(memoryItem)).find(
    (item) => !item.isActive,
  )!;
  await expect(
    editMemoryItem(
      database,
      {
        ...input,
        memoryId: inactive.id,
        expectedRevision: inactive.revision,
        content: "Likes mint tea.",
      },
      limits,
    ),
  ).rejects.toMatchObject({ code: "MEMORY_VALIDATION" });
  expect(
    (await database.select().from(memoryItem)).filter((item) => item.isActive),
  ).toHaveLength(1);
});

test("F5 no eviction at direct capacity and inferred activation waits for a free slot", async () => {
  const input = await source();
  await merge(input, "Likes green tea.", { configured: true });
  const second = await nextSource(input, 3);
  await merge(second, "Likes mint tea.", { configured: true });
  expect(
    (await database.select().from(memoryItem)).map((item) => item.content),
  ).toEqual(["Likes green tea."]);
  await merge(second, "Likes mint tea.", { inferred: true, configured: true });
  const third = await nextSource(input, 5);
  await merge(third, "Likes mint tea.", { inferred: true, configured: true });
  expect(
    (await database.select().from(memoryItem))
      .filter((item) => item.isActive)
      .map((item) => item.content),
  ).toEqual(["Likes green tea."]);
  const active = (await database.select().from(memoryItem)).find(
    (item) => item.isActive,
  )!;
  await deleteMemoryItem(database, { ...input, memoryId: active.id });
  const fourth = await nextSource(input, 7);
  await merge(fourth, "Likes mint tea.", { inferred: true, configured: true });
  expect(
    (await database.select().from(memoryItem))
      .filter((item) => item.isActive)
      .map((item) => item.content),
  ).toEqual(["Likes mint tea."]);
});

test("F5 concurrent direct insertions serialize the last capacity slot under real locks", async () => {
  const input = await source();
  const second = await nextSource(input, 3);
  const writer = createDatabase(testDatabaseUrl(), {
    application_name: "final-capacity-writer",
    max: 1,
  });
  let work: Promise<unknown> | undefined;
  try {
    await database.transaction(async (tx) => {
      const execute = mergeMemoryCandidates as unknown as (
        transaction: Parameters<typeof mergeMemoryCandidates>[0],
        input: Parameters<typeof mergeMemoryCandidates>[1],
        policy: typeof limits,
      ) => ReturnType<typeof mergeMemoryCandidates>;
      await execute(
        tx,
        {
          runId: input.runId,
          candidates: [extractionCandidate(input.sourceMessageId)],
          now: extractionNow,
        },
        limits,
      );
      work = merge(second, "Likes mint tea.", {
        configured: true,
        executor: writer,
      });
      await waitForExtractionLock(database, "final-capacity-writer");
    });
    await work;
    expect(
      (await database.select().from(memoryItem)).filter(
        (item) => item.isActive,
      ),
    ).toHaveLength(1);
  } finally {
    await work;
    await writer.$client.end();
  }
});
