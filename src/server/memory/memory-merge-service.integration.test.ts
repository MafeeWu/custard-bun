// @vitest-environment node
import { afterAll, beforeEach, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase } from "@/server/db/client";
import { memoryEvidence, memoryItem } from "@/server/db/schema";
import { testDatabaseUrl } from "@/test/database-target";
import {
  extractionAttempt,
  extractionCandidate,
  extractionFixture,
  extractionNow,
  resetExtractionDatabase,
  waitForExtractionLock,
} from "@/test/memory-extraction-fixture";
import { getCharacterMemoryView } from "./memory-queries";
import { editMemoryItem } from "./memory-service";
import { mergeMemoryCandidates } from "./memory-merge-service";
import { createExtractionRunForCompletedAttempt } from "./memory-extraction-service";
import { memoryDigest } from "./memory-normalization";

const database = createDatabase(testDatabaseUrl());
beforeEach(() => resetExtractionDatabase(database));
afterAll(() => database.$client.end());

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

async function merge(
  input: Awaited<ReturnType<typeof source>>,
  candidates: unknown,
  executor = database,
) {
  return executor.transaction((tx) =>
    mergeMemoryCandidates(tx, {
      runId: input.runId,
      candidates,
      now: extractionNow,
    }),
  );
}

test("direct facts are normalized, active, and immediately visible with evidence", async () => {
  const input = await source();
  await merge(input, [
    extractionCandidate(input.sourceMessageId, {
      content: "  Likes   green tea. ",
    }),
  ]);
  const view = await getCharacterMemoryView(database, input);
  expect(view!.items).toMatchObject([
    {
      content: "Likes green tea.",
      origin: "automatic",
      supportingSourceCount: 1,
    },
  ]);
});

test("inference requires two distinct user messages, not two deliveries", async () => {
  const input = await source();
  const candidate = extractionCandidate(input.sourceMessageId, {
    explicitness: "repeated_inference",
  });
  await merge(input, [candidate, candidate]);
  await merge(input, [candidate]);
  expect((await getCharacterMemoryView(database, input))!.items).toHaveLength(
    0,
  );
  expect(await database.select().from(memoryEvidence)).toHaveLength(1);
  const second = await extractionAttempt(database, input, 3);
  const run = await database.transaction((tx) =>
    createExtractionRunForCompletedAttempt(tx, {
      ...input,
      ...second,
      now: extractionNow,
    }),
  );
  await merge({ ...input, ...second, runId: run!.runId }, [
    extractionCandidate(second.sourceMessageId, {
      explicitness: "repeated_inference",
    }),
  ]);
  expect((await getCharacterMemoryView(database, input))!.items).toMatchObject([
    { supportingSourceCount: 2 },
  ]);
});

test("confirmation updates confidence importance recency and counts only distinct messages", async () => {
  const input = await source();
  await merge(input, [extractionCandidate(input.sourceMessageId)]);
  const second = await extractionAttempt(database, input, 3);
  const run = await database.transaction((tx) =>
    createExtractionRunForCompletedAttempt(tx, {
      ...input,
      ...second,
      now: extractionNow,
    }),
  );
  const later = new Date(extractionNow.getTime() + 1000);
  await database.transaction((tx) =>
    mergeMemoryCandidates(tx, {
      runId: run!.runId,
      now: later,
      candidates: [
        extractionCandidate(second.sourceMessageId, {
          confidence: 95,
          importance: 90,
        }),
      ],
    }),
  );
  expect((await database.select().from(memoryItem))[0]).toMatchObject({
    confidence: 95,
    importance: 90,
    lastConfirmedAt: later,
  });
  expect(await database.select().from(memoryEvidence)).toHaveLength(2);
});

test("foreign user, character, assistant, and historical source messages are rejected individually", async () => {
  const input = await source();
  const foreign = await source();
  const old = await extractionAttempt(database, input, 3);
  await merge(input, [
    extractionCandidate(foreign.sourceMessageId),
    extractionCandidate(input.assistantMessageId),
    extractionCandidate(old.sourceMessageId),
  ]);
  expect(await database.select().from(memoryItem)).toHaveLength(0);
});

test("credential and nonexplicit sensitive candidates never persist while ordinary candidates still merge", async () => {
  const input = await source();
  await merge(input, [
    extractionCandidate(input.sourceMessageId, {
      content: "My password is hidden",
    }),
    extractionCandidate(input.sourceMessageId, {
      content: "Medical condition",
      sensitivity: "personal_explicit",
    }),
    extractionCandidate(input.sourceMessageId, {
      content: "Medical condition",
      sensitivity: "personal_explicit",
      userExplicitlyAskedToRemember: true,
    }),
    extractionCandidate(input.sourceMessageId),
  ]);
  expect(
    (await database.select().from(memoryItem)).map((item) => item.content),
  ).toEqual(["Likes green tea."]);
});

test("strict raw JSON rejects extra provider keys before persistence", async () => {
  const input = await source();
  await expect(
    merge(input, [
      {
        ...extractionCandidate(input.sourceMessageId),
        normalizedDigest: "provider-digest",
      },
    ]),
  ).rejects.toMatchObject({ code: "CHAT_VALIDATION" });
  expect(await database.select().from(memoryItem)).toHaveLength(0);
});

test.each([
  "I remember my diagnosis.",
  "Do not remember my diagnosis.",
  "I don't want you to remember my diagnosis.",
])(
  "provider explicit-intent claims cannot override non-requests: %s",
  async (content) => {
    const input = await source();
    const { conversationMessage } = await import("@/server/db/schema");
    await database
      .update(conversationMessage)
      .set({ content })
      .where(eq(conversationMessage.id, input.sourceMessageId));
    await merge(input, [
      extractionCandidate(input.sourceMessageId, {
        type: "personal_fact",
        content: "Has a diagnosis.",
        sensitivity: "personal_explicit",
        userExplicitlyAskedToRemember: true,
      }),
    ]);
    expect(await database.select().from(memoryItem)).toHaveLength(0);
  },
);

test("real automatic writer waits for the Task 3 user lock and preserves a concurrent authoritative edit", async () => {
  const input = await source();
  await merge(input, [extractionCandidate(input.sourceMessageId)]);
  const item = (await database.select().from(memoryItem))[0];
  const editDatabase = createDatabase(testDatabaseUrl(), {
    application_name: "task5-user-edit",
    max: 1,
  });
  const writerDatabase = createDatabase(testDatabaseUrl(), {
    application_name: "task5-real-automatic-writer",
    max: 1,
  });
  const blocker = await database.$client.connect();
  let edit: Promise<unknown> | undefined;
  let write: Promise<unknown> | undefined;
  try {
    await blocker.query("BEGIN");
    await blocker.query(
      "SELECT id FROM chat_settings WHERE id = 'global' FOR UPDATE",
    );
    edit = editMemoryItem(editDatabase, {
      ...input,
      memoryId: item.id,
      expectedRevision: item.revision,
      content: "User prefers coffee.",
    });
    expect(await waitForExtractionLock(database, "task5-user-edit")).toMatch(
      /chat_settings/,
    );
    write = merge(
      input,
      [
        extractionCandidate(input.sourceMessageId, {
          content: "Provider replacement.",
          mergeTargetDigest: memoryDigest({
            type: item.type,
            normalizedContent: item.normalizedContent,
          }),
        }),
      ],
      writerDatabase,
    );
    expect(
      await waitForExtractionLock(database, "task5-real-automatic-writer"),
    ).toMatch(/chat_settings/);
    await blocker.query("COMMIT");
    await Promise.all([edit, write]);
    expect(
      (
        await database
          .select()
          .from(memoryItem)
          .where(eq(memoryItem.id, item.id))
      )[0],
    ).toMatchObject({
      content: "User prefers coffee.",
      origin: "user_edited",
      revision: item.revision + 1,
    });
    expect(await database.select().from(memoryItem)).toHaveLength(1);
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
    await Promise.allSettled([edit, write].filter(Boolean));
    await editDatabase.$client.end();
    await writerDatabase.$client.end();
  }
});

test("automatic merge locks settings before a user lock held on another connection", async () => {
  const input = await source();
  const other = createDatabase(testDatabaseUrl(), {
    application_name: "task5-merge-lock-order",
    max: 1,
  });
  const settingsBlocker = await database.$client.connect();
  const userBlocker = await database.$client.connect();
  let write: Promise<unknown> | undefined;
  try {
    await settingsBlocker.query("BEGIN");
    await userBlocker.query("BEGIN");
    await settingsBlocker.query(
      "SELECT id FROM chat_settings WHERE id = 'global' FOR UPDATE",
    );
    await userBlocker.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      ["chat-user:" + input.userId],
    );
    write = merge(input, [extractionCandidate(input.sourceMessageId)], other);
    expect(
      await waitForExtractionLock(database, "task5-merge-lock-order"),
    ).toMatch(/chat_settings/);
    await settingsBlocker.query("COMMIT");
    expect(
      await waitForExtractionLock(database, "task5-merge-lock-order"),
    ).toMatch(/pg_advisory_xact_lock/);
    await userBlocker.query("COMMIT");
    await write;
  } finally {
    await settingsBlocker.query("ROLLBACK");
    await userBlocker.query("ROLLBACK");
    settingsBlocker.release();
    userBlocker.release();
    await Promise.allSettled(write ? [write] : []);
    await other.$client.end();
  }
});
