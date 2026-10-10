// @vitest-environment node
import { afterAll, beforeEach, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase } from "@/server/db/client";
import {
  relationshipSummary,
  relationshipSummaryRun,
  relationshipSummaryVersion,
  memoryItem,
  user,
  userCharacterMemorySetting,
} from "@/server/db/schema";
import { testDatabaseUrl } from "@/test/database-target";
import {
  extractionCounter,
  extractionGateway,
  resetExtractionDatabase,
  waitForExtractionLock,
} from "@/test/memory-extraction-fixture";
import { summaryFixture, summaryResult } from "@/test/memory-summary-fixture";
import {
  DEFAULT_RELATIONSHIP_SUMMARY_POLICY,
  editRelationshipSummary as editRelationshipSummaryWithRuntimeConfig,
  getRelationshipSummary,
  requestSummaryRegeneration,
  ensureAutomaticSummaryRefresh,
  relationshipSummaryPolicyFromConfig,
} from "./relationship-summary-service";
import { processRelationshipSummaryRefresh } from "./relationship-summary-job";
import {
  deleteMemoryItem,
  editMemoryItem,
  forgetCharacter,
  updateMemoryControls,
} from "./memory-service";

const database = createDatabase(testDatabaseUrl());
const signal = new AbortController().signal;
const configuredSecrets = {
  modelApiKey: "mQ7vN2pR8sT4wX6z",
  authSecret: "aB3dE5fG7hJ9kL2mN4pQ6rS8tV1xZ3cD",
  smtpPassword: "sM9nP2qR5tV8xZ1b",
  databasePassword: "dB4fH7jK2mN5pQ8s",
};
const configuredSummaryPolicy = (maxSummaryCharacters: number) =>
  relationshipSummaryPolicyFromConfig({
    public: { memory: { maxSummaryCharacters } },
    secret: {
      databaseUrl: `postgresql://app:${configuredSecrets.databasePassword}@127.0.0.1:5432/app`,
      betterAuthSecret: configuredSecrets.authSecret,
      smtp: { password: configuredSecrets.smtpPassword },
      model: { apiKey: configuredSecrets.modelApiKey },
    },
  });
const editRelationshipSummary = (
  database: Parameters<typeof editRelationshipSummaryWithRuntimeConfig>[0],
  input: Parameters<typeof editRelationshipSummaryWithRuntimeConfig>[1],
) =>
  editRelationshipSummaryWithRuntimeConfig(
    database,
    input,
    DEFAULT_RELATIONSHIP_SUMMARY_POLICY,
  );
const editWithPolicy = editRelationshipSummaryWithRuntimeConfig as unknown as (
  database: Parameters<typeof editRelationshipSummaryWithRuntimeConfig>[0],
  input: Parameters<typeof editRelationshipSummaryWithRuntimeConfig>[1],
  policy: ReturnType<typeof configuredSummaryPolicy>,
) => ReturnType<typeof editRelationshipSummaryWithRuntimeConfig>;
beforeEach(() => resetExtractionDatabase(database));
afterAll(() => database.$client.end());

test("committed memoryRevision creates one pending refresh independent of settings revision", async () => {
  const input = await summaryFixture(database);
  expect(input.operationId).toEqual(expect.any(String));
  await database.transaction((tx) => ensureAutomaticSummaryRefresh(tx, input));
  await updateMemoryControls(database, {
    ...input,
    expectedRevision: 1,
    recordingEnabled: true,
    usageEnabled: false,
  });
  await database.transaction((tx) => ensureAutomaticSummaryRefresh(tx, input));
  expect(await database.select().from(relationshipSummaryRun)).toMatchObject([
    { status: "pending", basedOnMemoryRevision: 1, expectedSummaryRevision: 0 },
  ]);
  expect(await database.select().from(relationshipSummaryRun)).toHaveLength(1);
});

test("user edits and clear create immutable current versions with optimistic revisions", async () => {
  const input = await summaryFixture(database);
  expect(await getRelationshipSummary(database, input)).toBeNull();
  const first = await editRelationshipSummary(database, {
    ...input,
    expectedRevision: 0,
    content: "  Ｇｒｅｅｎ\ttea.  ",
  });
  expect(first.revision).toBe(1);
  expect(await getRelationshipSummary(database, input)).toMatchObject({
    revision: 1,
    versionId: first.versionId,
    content: "Green tea.",
    origin: "user_edited",
  });
  await expect(
    editRelationshipSummary(database, {
      ...input,
      expectedRevision: 0,
      content: "stale",
    }),
  ).rejects.toMatchObject({ code: "MEMORY_REVISION_CONFLICT" });
  const cleared = await editRelationshipSummary(database, {
    ...input,
    expectedRevision: 1,
    content: " \n ",
  });
  expect(cleared.revision).toBe(2);
  expect(await getRelationshipSummary(database, input)).toMatchObject({
    revision: 2,
    content: "",
    origin: "user_edited",
  });
  const versions = await database.select().from(relationshipSummaryVersion);
  expect(versions).toHaveLength(2);
  expect(versions.find((v) => v.id === first.versionId)?.content).toBe(
    "Green tea.",
  );
  await expect(
    database.update(relationshipSummaryVersion).set({ content: "overwrite" }),
  ).rejects.toThrow();
});

test("automatic refresh cannot replace even an empty user-edited summary", async () => {
  const input = await summaryFixture(database);
  await editRelationshipSummary(database, {
    ...input,
    expectedRevision: 0,
    content: "",
  });
  await database.update(userCharacterMemorySetting).set({ memoryRevision: 2 });
  expect(
    await database.transaction((tx) =>
      ensureAutomaticSummaryRefresh(tx, input),
    ),
  ).toBeNull();
  await processRelationshipSummaryRefresh(
    database,
    extractionGateway(async () => {
      throw new Error("Must not call provider.");
    }),
    extractionCounter,
    input.operationId!,
    signal,
  );
  expect(await getRelationshipSummary(database, input)).toMatchObject({
    content: "",
    revision: 1,
  });
  expect(await database.select().from(relationshipSummaryVersion)).toHaveLength(
    1,
  );
});

test("explicit regeneration confirms the summary revision, preserves edited content until success, and can repeat", async () => {
  const input = await summaryFixture(database);
  await editRelationshipSummary(database, {
    ...input,
    expectedRevision: 0,
    content: "My version.",
  });
  await expect(
    requestSummaryRegeneration(database, { ...input, expectedRevision: 0 }),
  ).rejects.toMatchObject({ code: "MEMORY_REVISION_CONFLICT" });
  const requested = await requestSummaryRegeneration(database, {
    ...input,
    expectedRevision: 1,
  });
  expect(
    await requestSummaryRegeneration(database, {
      ...input,
      expectedRevision: 1,
    }),
  ).toEqual(requested);
  expect(await getRelationshipSummary(database, input)).toMatchObject({
    content: "My version.",
    revision: 1,
  });
  await processRelationshipSummaryRefresh(
    database,
    extractionGateway(async (request) => {
      expect(request.messages[1].content).not.toContain("My version.");
      return summaryResult();
    }),
    extractionCounter,
    requested.operationId,
    signal,
  );
  expect(await getRelationshipSummary(database, input)).toMatchObject({
    content: "Enjoys green tea.",
    revision: 2,
    origin: "automatic",
  });
  expect(await database.select().from(relationshipSummaryVersion)).toHaveLength(
    2,
  );
  const again = await requestSummaryRegeneration(database, {
    ...input,
    expectedRevision: 2,
  });
  expect(again.operationId).not.toBe(requested.operationId);
});

test("forget removes every immutable version and pointer and cancels pending refresh", async () => {
  const input = await summaryFixture(database);
  await editRelationshipSummary(database, {
    ...input,
    expectedRevision: 0,
    content: "First.",
  });
  await editRelationshipSummary(database, {
    ...input,
    expectedRevision: 1,
    content: "",
  });
  const requested = await requestSummaryRegeneration(database, {
    ...input,
    expectedRevision: 2,
  });
  await forgetCharacter(database, { ...input, expectedRevision: 1 });
  expect(await getRelationshipSummary(database, input)).toBeNull();
  expect(await database.select().from(relationshipSummaryVersion)).toEqual([]);
  expect(await database.select().from(relationshipSummary)).toEqual([]);
  expect(
    (
      await database
        .select()
        .from(relationshipSummaryRun)
        .where(eq(relationshipSummaryRun.id, requested.operationId))
    )[0].status,
  ).toBe("cancelled");
});

test.each(["owner", "pending-deletion"] as const)(
  "summary access rejects %s boundaries",
  async (kind) => {
    const input = await summaryFixture(database);
    await editRelationshipSummary(database, {
      ...input,
      expectedRevision: 0,
      content: "Private.",
    });
    const scope = kind === "owner" ? { ...input, userId: "not-owner" } : input;
    if (kind === "pending-deletion")
      await database.update(user).set({ deletionPendingAt: new Date() });
    expect(await getRelationshipSummary(database, scope)).toBeNull();
    await expect(
      editRelationshipSummary(database, {
        ...scope,
        expectedRevision: 1,
        content: "Bad.",
      }),
    ).rejects.toMatchObject({ code: "MEMORY_NOT_FOUND" });
  },
);

test.each(["x".repeat(4001), "ﬃ".repeat(1334), "My password is hunter2"])(
  "manual edits reject overflow or credentials without a new version",
  async (content) => {
    const input = await summaryFixture(database);
    await expect(
      editRelationshipSummary(database, {
        ...input,
        expectedRevision: 0,
        content,
      }),
    ).rejects.toMatchObject({ code: "MEMORY_VALIDATION" });
    expect(
      await database.select().from(relationshipSummaryVersion),
    ).toHaveLength(0);
  },
);

test("successive memory revisions append immutable automatic history and supply only the prior automatic summary", async () => {
  const input = await summaryFixture(database);
  await processRelationshipSummaryRefresh(
    database,
    extractionGateway(async () => summaryResult()),
    extractionCounter,
    input.operationId!,
    signal,
  );
  const first = await getRelationshipSummary(database, input);
  await database.update(userCharacterMemorySetting).set({ memoryRevision: 2 });
  const next = await database.transaction((tx) =>
    ensureAutomaticSummaryRefresh(tx, input),
  );
  expect(next?.operationId).toEqual(expect.any(String));
  await processRelationshipSummaryRefresh(
    database,
    extractionGateway(async (request) => {
      expect(
        JSON.parse(request.messages[1].content).priorAutomaticSummary,
      ).toBe("Enjoys green tea.");
      return summaryResult("Still enjoys green tea.");
    }),
    extractionCounter,
    next!.operationId,
    signal,
  );
  expect(await getRelationshipSummary(database, input)).toMatchObject({
    revision: 2,
    basedOnMemoryRevision: 2,
    content: "Still enjoys green tea.",
  });
  const versions = await database.select().from(relationshipSummaryVersion);
  expect(versions).toHaveLength(2);
  expect(versions.find((v) => v.id === first?.versionId)?.content).toBe(
    "Enjoys green tea.",
  );
  expect(
    await database.transaction((tx) =>
      ensureAutomaticSummaryRefresh(tx, input),
    ),
  ).toBeNull();
});

test("simultaneous edits compare and advance a single summary revision", async () => {
  const input = await summaryFixture(database);
  const results = await Promise.allSettled([
    editRelationshipSummary(database, {
      ...input,
      expectedRevision: 0,
      content: "One.",
    }),
    editRelationshipSummary(database, {
      ...input,
      expectedRevision: 0,
      content: "Two.",
    }),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(results.find((result) => result.status === "rejected")).toMatchObject({
    status: "rejected",
    reason: { code: "MEMORY_REVISION_CONFLICT" },
  });
  expect(await database.select().from(relationshipSummaryVersion)).toHaveLength(
    1,
  );
});

test("the 4000-character boundary counts Unicode code points, not UTF-16 halves", async () => {
  const input = await summaryFixture(database);
  await editRelationshipSummary(database, {
    ...input,
    expectedRevision: 0,
    content: "😀".repeat(4000),
  });

  expect((await getRelationshipSummary(database, input))?.content).toBe(
    "😀".repeat(4000),
  );
  await expect(
    editRelationshipSummary(database, {
      ...input,
      expectedRevision: 1,
      content: "😀".repeat(4001),
    }),
  ).rejects.toMatchObject({ code: "MEMORY_VALIDATION" });
});

test("configured 100-character manual edit limit allows 100 code points and rejects 101", async () => {
  const input = await summaryFixture(database);
  const policy = configuredSummaryPolicy(100);
  await editWithPolicy(
    database,
    {
      ...input,
      expectedRevision: 0,
      content: "😀".repeat(100),
    },
    policy,
  );
  expect((await getRelationshipSummary(database, input))?.content).toBe(
    "😀".repeat(100),
  );
  await expect(
    editWithPolicy(
      database,
      {
        ...input,
        expectedRevision: 1,
        content: "😀".repeat(101),
      },
      policy,
    ),
  ).rejects.toMatchObject({ code: "MEMORY_VALIDATION" });
  expect(await database.select().from(relationshipSummaryVersion)).toHaveLength(
    1,
  );
});

test.each([
  { kind: "model API key", value: configuredSecrets.modelApiKey },
  { kind: "auth secret", value: configuredSecrets.authSecret },
  { kind: "SMTP password", value: configuredSecrets.smtpPassword },
  { kind: "database password", value: configuredSecrets.databasePassword },
])(
  "manual edits reject configured runtime $kind",
  async ({ value: secretValue }) => {
    const input = await summaryFixture(database);
    await expect(
      editWithPolicy(
        database,
        {
          ...input,
          expectedRevision: 0,
          content: `Reflected value: ${secretValue}`,
        },
        configuredSummaryPolicy(4000),
      ),
    ).rejects.toMatchObject({ code: "MEMORY_VALIDATION" });
    expect(
      await database.select().from(relationshipSummaryVersion),
    ).toHaveLength(0);
  },
);

test.each(["edit", "delete"] as const)(
  "named PostgreSQL memory %s locks summary versions before memory rows",
  async (kind) => {
    const input = await summaryFixture(database);
    await processRelationshipSummaryRefresh(
      database,
      extractionGateway(async () => summaryResult()),
      extractionCounter,
      input.operationId!,
      signal,
    );
    const view = await getRelationshipSummary(database, input);
    const [item] = await database.select().from(memoryItem);
    const blocker = createDatabase(testDatabaseUrl(), {
      application_name: `task6-memory-${kind}-blocker`,
      max: 1,
    });
    const writerName = `task6-memory-${kind}-writer`;
    const writer = createDatabase(testDatabaseUrl(), {
      application_name: writerName,
      max: 1,
    });
    let work: Promise<unknown> | undefined;
    try {
      await blocker.$client.query("BEGIN");
      await blocker.$client.query(
        "SELECT id FROM relationship_summary_versions WHERE id = $1 FOR UPDATE",
        [view!.versionId],
      );
      work =
        kind === "edit"
          ? editMemoryItem(writer, {
              ...input,
              memoryId: item.id,
              expectedRevision: item.revision,
              content: "Likes black tea.",
            })
          : deleteMemoryItem(writer, { ...input, memoryId: item.id });
      void work.catch(() => undefined);
      expect(await waitForExtractionLock(database, writerName)).toMatch(
        /relationship_summary_versions/,
      );
      const probe = await database.$client.connect();
      try {
        await probe.query("BEGIN");
        await expect(
          probe.query(
            "SELECT id FROM memory_items WHERE id = $1 FOR UPDATE NOWAIT",
            [item.id],
          ),
        ).resolves.toMatchObject({ rowCount: 1 });
      } finally {
        await probe.query("ROLLBACK");
        probe.release();
      }
      await blocker.$client.query("COMMIT");
      await work;
    } finally {
      await blocker.$client.query("ROLLBACK").catch(() => undefined);
      await Promise.allSettled(work ? [work] : []);
      await blocker.$client.end();
      await writer.$client.end();
    }
  },
);

test("confirmed regeneration retries a failed execution without resetting its operation identity or budget", async () => {
  const input = await summaryFixture(database);
  await editRelationshipSummary(database, {
    ...input,
    expectedRevision: 0,
    content: "Keep until success.",
  });
  const requested = await requestSummaryRegeneration(database, {
    ...input,
    expectedRevision: 1,
  });
  await expect(
    processRelationshipSummaryRefresh(
      database,
      extractionGateway(async () => summaryResult(42)),
      extractionCounter,
      requested.operationId,
      signal,
    ),
  ).rejects.toMatchObject({ code: "MEMORY_VALIDATION" });
  expect(await getRelationshipSummary(database, input)).toMatchObject({
    content: "Keep until success.",
    revision: 1,
  });
  expect(
    await requestSummaryRegeneration(database, {
      ...input,
      expectedRevision: 1,
    }),
  ).toEqual(requested);
  await processRelationshipSummaryRefresh(
    database,
    extractionGateway(async () => summaryResult()),
    extractionCounter,
    requested.operationId,
    signal,
  );
  expect(await getRelationshipSummary(database, input)).toMatchObject({
    content: "Enjoys green tea.",
    revision: 2,
  });
  expect(
    (
      await database
        .select()
        .from(relationshipSummaryRun)
        .where(eq(relationshipSummaryRun.id, requested.operationId))
    )[0],
  ).toMatchObject({ status: "complete", attemptCount: 2 });
});
