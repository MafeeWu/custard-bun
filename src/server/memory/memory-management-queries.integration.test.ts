// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase } from "@/server/db/client";
import {
  conversation,
  memoryExtractionRun,
  user,
  userCharacterMemorySetting,
} from "@/server/db/schema";
import { testDatabaseUrl } from "@/test/database-target";
import {
  extractionAttempt,
  extractionFixture,
  extractionNow,
  resetExtractionDatabase,
} from "@/test/memory-extraction-fixture";
import { createExtractionRunForCompletedAttempt } from "./memory-extraction-service";
import {
  getRelationshipMemoryScreenView,
  listMemoryRelationships,
} from "./memory-queries";
import { editRelationshipSummary } from "./relationship-summary-service";
import { forgetCharacter } from "./memory-service";

const database = createDatabase(testDatabaseUrl());
beforeEach(() => resetExtractionDatabase(database));
afterAll(() => database.$client.end());

test("screen DTO scopes even absent and recreated summary revisions to the relationship epoch", async () => {
  const input = await extractionFixture(database);
  expect(await getRelationshipMemoryScreenView(database, input)).toMatchObject({
    summaryRevision: 0,
    summaryEpoch: 0,
  });
  await editRelationshipSummary(
    database,
    {
      ...input,
      expectedRevision: 0,
      expectedMemoryEpoch: 0,
      content: "Old",
      userExplicitlyAskedToRemember: true,
    },
    { maxSummaryCharacters: 4000, secretValues: [] },
  );
  await forgetCharacter(database, { ...input, expectedRevision: 1 });
  expect(await getRelationshipMemoryScreenView(database, input)).toMatchObject({
    summaryRevision: 0,
    summaryEpoch: 1,
  });
  await editRelationshipSummary(
    database,
    {
      ...input,
      expectedRevision: 0,
      expectedMemoryEpoch: 1,
      content: "New",
      userExplicitlyAskedToRemember: true,
    },
    { maxSummaryCharacters: 4000, secretValues: [] },
  );
  expect(await getRelationshipMemoryScreenView(database, input)).toMatchObject({
    summaryRevision: 1,
    summaryEpoch: 1,
    summary: { content: "New" },
  });
});
test("overview and screen isolate owner relationships including after transcript deletion", async () => {
  const own = await extractionFixture(database);
  const other = await extractionFixture(database);
  expect(await listMemoryRelationships(database, own.userId)).toEqual([
    {
      character: { id: own.characterId, displayName: "Mira" },
      itemCount: 0,
      recordingEnabled: true,
      usageEnabled: true,
    },
  ]);
  expect(
    await getRelationshipMemoryScreenView(database, {
      userId: own.userId,
      characterId: other.characterId,
    }),
  ).toBeNull();
  expect(
    await getRelationshipMemoryScreenView(database, {
      userId: own.userId,
      characterId: randomUUID(),
    }),
  ).toBeNull();
  await database.insert(userCharacterMemorySetting).values(own);
  await database
    .delete(conversation)
    .where(eq(conversation.id, own.conversationId));
  expect(await getRelationshipMemoryScreenView(database, own)).not.toBeNull();
});
test.each([
  "pending",
  "retrying",
  "failed",
  "dead_letter",
  "cancelled",
  "complete",
] as const)(
  "safe %s extraction state has retry only when source and budget permit",
  async (status) => {
    const input = await extractionFixture(database);
    const attempt = await extractionAttempt(database, input);
    const run = await database.transaction((tx) =>
      createExtractionRunForCompletedAttempt(tx, {
        ...input,
        ...attempt,
        now: extractionNow,
      }),
    );
    await database
      .update(memoryExtractionRun)
      .set({
        status,
        finishedAt: ["failed", "dead_letter", "cancelled", "complete"].includes(
          status,
        )
          ? new Date()
          : null,
        providerRequestIds: ["private-provider"],
        errorCategory: "private-error",
      })
      .where(eq(memoryExtractionRun.id, run!.runId));
    const view = await getRelationshipMemoryScreenView(database, input);
    const exposed = view!.extractions;
    if (["cancelled", "complete"].includes(status)) expect(exposed).toEqual([]);
    else
      expect(exposed).toEqual([
        {
          id: run!.runId,
          status: {
            pending: "processing",
            retrying: "retrying",
            failed: "needs_retry",
            dead_letter: "needs_retry",
          }[status as "pending"],
          canRetry: status === "failed" || status === "dead_letter",
        },
      ]);
    expect(JSON.stringify(view)).not.toMatch(
      /private-|memoryEpoch|memoryRevision|provider|candidates|errorCategory/,
    );
  },
);
test("exhausted dead-letter extraction cannot be retried", async () => {
  const input = await extractionFixture(database);
  const attempt = await extractionAttempt(database, input);
  const run = await database.transaction((tx) =>
    createExtractionRunForCompletedAttempt(tx, {
      ...input,
      ...attempt,
      now: extractionNow,
    }),
  );
  await database
    .update(memoryExtractionRun)
    .set({ status: "dead_letter", attemptCount: 5, finishedAt: new Date() })
    .where(eq(memoryExtractionRun.id, run!.runId));
  expect(
    (await getRelationshipMemoryScreenView(database, input))!.extractions[0],
  ).toMatchObject({ status: "needs_retry", canRetry: false });
});
test("cleared summary retains its optimistic revision and deletion-pending owners see no relationships", async () => {
  const input = await extractionFixture(database);
  await editRelationshipSummary(
    database,
    { ...input, expectedRevision: 0, expectedMemoryEpoch: 0, content: "" },
    { maxSummaryCharacters: 4000, secretValues: [] },
  );
  expect(
    (await getRelationshipMemoryScreenView(database, input))!.summaryRevision,
  ).toBe(1);
  await database
    .update(user)
    .set({ deletionPendingAt: new Date() })
    .where(eq(user.id, input.userId));
  expect(await listMemoryRelationships(database, input.userId)).toEqual([]);
  expect(await getRelationshipMemoryScreenView(database, input)).toBeNull();
});
