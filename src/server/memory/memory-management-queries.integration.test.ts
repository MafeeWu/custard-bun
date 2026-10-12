// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase } from "@/server/db/client";
import {
  conversation,
  memoryExtractionRun,
  relationshipSummary,
  relationshipSummaryRun,
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
import {
  editRelationshipSummary,
  getRelationshipSummary,
  requestSummaryRegeneration,
} from "./relationship-summary-service";
import {
  deleteMemoryItem,
  forgetCharacter,
  updateMemoryControls,
} from "./memory-service";
import { summaryFixture } from "@/test/memory-summary-fixture";

const database = createDatabase(testDatabaseUrl());
beforeEach(() => resetExtractionDatabase(database));
afterAll(() => database.$client.end());

test.each([
  { action: "save", recordingEnabled: true },
  { action: "clear", recordingEnabled: true },
  { action: "regenerate", recordingEnabled: true },
  { action: "save", recordingEnabled: false },
  { action: "clear", recordingEnabled: false },
  { action: "regenerate", recordingEnabled: false },
] as const)(
  "reload after deleting the last item permits $action with recordingEnabled=$recordingEnabled without resurrecting summary recall",
  async ({ action, recordingEnabled }) => {
    const input = await summaryFixture(database);
    const policy = { maxSummaryCharacters: 4000, secretValues: [] };
    await editRelationshipSummary(
      database,
      {
        ...input,
        expectedRevision: 0,
        expectedMemoryEpoch: 0,
        content: "Enjoys green tea.",
        userExplicitlyAskedToRemember: true,
      },
      policy,
    );
    if (!recordingEnabled)
      await updateMemoryControls(database, {
        ...input,
        expectedRevision: 1,
        recordingEnabled: false,
        usageEnabled: true,
      });
    const stale = (await getRelationshipMemoryScreenView(database, input))!;
    expect(stale.summaryRevision).toBe(1);
    await deleteMemoryItem(database, {
      ...input,
      memoryId: stale.items[0].id,
      expectedRevision: stale.items[0].revision,
    });

    const reloaded = (await getRelationshipMemoryScreenView(database, input))!;
    expect(reloaded.items).toEqual([]);
    expect(reloaded.summary).toBeNull();
    expect(await getRelationshipSummary(database, input)).toBeNull();
    expect(reloaded.settings.recordingEnabled).toBe(recordingEnabled);
    const [stored] = await database
      .select()
      .from(relationshipSummary)
      .where(eq(relationshipSummary.userId, input.userId));
    expect(stored).toMatchObject({ currentVersionId: null, revision: 2 });

    const perform = (view: typeof reloaded) => {
      const revision = {
        ...input,
        expectedRevision: view.summaryRevision,
        expectedMemoryEpoch: view.summaryEpoch,
      };
      return action === "regenerate"
        ? requestSummaryRegeneration(database, revision)
        : editRelationshipSummary(
            database,
            {
              ...revision,
              content: action === "save" ? "A new beginning." : "",
              userExplicitlyAskedToRemember: action === "save",
            },
            policy,
          );
    };
    await expect(perform(stale)).rejects.toMatchObject({
      code: "MEMORY_REVISION_CONFLICT",
      metadata: { expectedRevision: 1, actualRevision: 2 },
    });
    if (action === "regenerate" && !recordingEnabled) {
      await expect(perform(reloaded)).rejects.toMatchObject({
        code: "MEMORY_VALIDATION",
        message: "Summary recording is disabled.",
      });
    } else {
      await expect(perform(reloaded)).resolves.toMatchObject(
        action === "regenerate"
          ? { operationId: expect.any(String) }
          : { revision: 3 },
      );
    }
    expect(reloaded.summaryRevision).toBe(2);
    if (action === "regenerate") {
      const runs = await database
        .select()
        .from(relationshipSummaryRun)
        .where(eq(relationshipSummaryRun.userId, input.userId));
      expect(runs.filter((run) => run.status === "pending")).toMatchObject(
        recordingEnabled ? [{ expectedSummaryRevision: 2 }] : [],
      );
      expect(
        (await getRelationshipMemoryScreenView(database, input))!.summary,
      ).toBeNull();
      expect(await getRelationshipSummary(database, input)).toBeNull();
    } else {
      expect(
        await getRelationshipMemoryScreenView(database, input),
      ).toMatchObject({
        summaryRevision: 3,
        summary: {
          content: action === "save" ? "A new beginning." : "",
          origin: "user_edited",
          revision: 3,
        },
      });
    }
  },
);

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
