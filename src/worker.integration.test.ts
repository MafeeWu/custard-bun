// @vitest-environment node
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { validSecretEnv } from "@/test/unit/runtime-config-fixture";
import { createDatabase } from "@/server/db/client";
import {
  memoryExtractionRun,
  memoryItem,
  relationshipSummaryRun,
  relationshipSummaryVersion,
  usageLedger,
} from "@/server/db/schema";
import {
  registerMemoryExtractionWorker,
  processMemoryExtractionRun,
} from "@/server/memory/memory-job";
import { enqueuePendingSummaryRuns } from "@/server/memory/relationship-summary-job";
import {
  createExtractionRunForCompletedAttempt,
  enqueuePendingExtractionRuns,
} from "@/server/memory/memory-extraction-service";
import {
  extractionAttempt,
  extractionCandidate,
  extractionCounter,
  extractionFixture,
  extractionGateway,
  extractionNow,
  extractionResult,
  resetExtractionDatabase,
} from "@/test/memory-extraction-fixture";
import type { PgBoss } from "pg-boss";
import { createBoss } from "@/server/jobs/boss";
import {
  AUTH_EMAIL_QUEUE,
  MEMORY_EXTRACTION_QUEUE,
  MEMORY_EXTRACTION_DEAD_LETTER_QUEUE,
  RELATIONSHIP_SUMMARY_QUEUE,
  RELATIONSHIP_SUMMARY_DEAD_LETTER_QUEUE,
  ensureQueues,
} from "@/server/jobs/queues";
import { testDatabaseUrl } from "@/test/database-target";
import { eq, sql } from "drizzle-orm";
import { ModelGatewayError } from "@/server/model-gateway/model-error";

const databaseUrl = testDatabaseUrl();
let boss: PgBoss;

beforeAll(async () => {
  boss = createBoss(databaseUrl);
  await boss.start();
  await ensureQueues(boss, { authEmailRetryDelay: 60 });
  await boss.deleteAllJobs(AUTH_EMAIL_QUEUE);
});

afterAll(async () => {
  await boss.offWork(AUTH_EMAIL_QUEUE);
  await boss.deleteAllJobs(AUTH_EMAIL_QUEUE);
  await boss.stop({ graceful: false });
});

test("retains an SMTP failure for retry on the production queue", async () => {
  const queue = await boss.getQueue(AUTH_EMAIL_QUEUE);

  expect(queue?.name).toBe(AUTH_EMAIL_QUEUE);
  expect(queue?.retryLimit).toBe(5);
  expect(queue?.retryDelay).toBe(60);
  expect(queue?.retryBackoff).toBe(true);
  expect(queue?.deadLetter).toBe("auth-email-dead-letter");

  const id = await boss.send(AUTH_EMAIL_QUEUE, { to: "person@example.com" });
  if (!id) {
    throw new Error("retry test job was not accepted");
  }

  let attempts = 0;
  await boss.work(AUTH_EMAIL_QUEUE, async () => {
    attempts += 1;
    throw new Error("temporary SMTP failure");
  });

  await expect.poll(() => attempts, { timeout: 5_000 }).toBe(1);
  await expect
    .poll(async () => (await boss.getJobById(AUTH_EMAIL_QUEUE, id))?.state, {
      timeout: 5_000,
    })
    .toBe("retry");

  const job = await boss.getJobById(AUTH_EMAIL_QUEUE, id);
  // pg-boss 12.33.6 reports retryCount as 0 immediately after the first failure;
  // the durable signal for "will retry" is the retry state plus persisted output.
  expect(job?.retryCount).toBe(0);
  expect(job?.output).toEqual(
    expect.objectContaining({ message: "temporary SMTP failure" }),
  );
  expect(job?.startedOn).toBeTruthy();
  expect(job?.state).toBe("retry");
});

test("production extraction worker startup reconciles a committed run while keeping auth registration intact", async () => {
  const database = createDatabase(testDatabaseUrl());
  const logger = { error: vi.fn() };
  let stop: (() => Promise<void>) | undefined;
  try {
    await resetExtractionDatabase(database);
    await boss.deleteAllJobs(MEMORY_EXTRACTION_QUEUE);
    const fixture = await extractionFixture(database);
    const attempt = await extractionAttempt(database, fixture);
    await database.transaction((tx) =>
      createExtractionRunForCompletedAttempt(tx, {
        ...fixture,
        ...attempt,
        now: extractionNow,
      }),
    );
    stop = await registerMemoryExtractionWorker(
      database,
      boss,
      extractionGateway(async () =>
        extractionResult([extractionCandidate(attempt.sourceMessageId)]),
      ),
      extractionCounter,
      logger,
    );
    await expect
      .poll(
        async () =>
          (await database.select().from(memoryExtractionRun))[0].status,
        { timeout: 6_000 },
      )
      .toBe("complete");
    expect(await database.select().from(memoryItem)).toHaveLength(1);
    expect(logger.error).not.toHaveBeenCalled();
    expect(await boss.getQueue(AUTH_EMAIL_QUEUE)).not.toBeNull();
  } finally {
    await stop?.();
    await boss.offWork(MEMORY_EXTRACTION_QUEUE);
    await boss.deleteAllJobs(MEMORY_EXTRACTION_QUEUE);
    await boss.deleteAllJobs(MEMORY_EXTRACTION_DEAD_LETTER_QUEUE);
    await database.$client.end();
  }
});

test("production extraction queue exhausts exactly five executions into a safe dead-letter job", async () => {
  const database = createDatabase(testDatabaseUrl());
  const logger = { error: vi.fn() };
  let stop: (() => Promise<void>) | undefined;
  try {
    await resetExtractionDatabase(database);
    await boss.deleteAllJobs(MEMORY_EXTRACTION_QUEUE);
    const fixture = await extractionFixture(database);
    const attempt = await extractionAttempt(database, fixture);
    const run = await database.transaction((tx) =>
      createExtractionRunForCompletedAttempt(tx, {
        ...fixture,
        ...attempt,
        now: extractionNow,
      }),
    );
    stop = await registerMemoryExtractionWorker(
      database,
      boss,
      extractionGateway(async () => {
        throw new ModelGatewayError("server", {
          retryable: true,
          providerRequestId: "private-provider-id",
        });
      }),
      extractionCounter,
      logger,
    );
    let jobId: string | null = null;
    for (let count = 1; count <= 5; count++) {
      await expect
        .poll(
          async () => {
            const row = (await database.select().from(memoryExtractionRun))[0];
            return { status: row.status, count: row.attemptCount };
          },
          { timeout: 6_000 },
        )
        .toEqual({ status: count < 5 ? "retrying" : "dead_letter", count });
      const durable = (await database.select().from(memoryExtractionRun))[0];
      expect(durable.attemptCount).toBe(count);
      jobId = durable.jobId;
      await expect
        .poll(
          async () =>
            (await boss.getJobById(MEMORY_EXTRACTION_QUEUE, jobId!))?.state,
          { timeout: 6_000 },
        )
        .toBe(count < 5 ? "retry" : "completed");
      if (count < 5) {
        await database
          .update(memoryExtractionRun)
          .set({ nextRetryAt: new Date(0) })
          .where(eq(memoryExtractionRun.id, run!.runId));
        await database.execute(
          sql`UPDATE job.job SET start_after = NOW() WHERE id = ${jobId} AND name = ${MEMORY_EXTRACTION_QUEUE}`,
        );
      }
    }
    const deadLetters = await boss.fetch<{ runId: string }>(
      MEMORY_EXTRACTION_DEAD_LETTER_QUEUE,
    );
    expect(deadLetters).toMatchObject([{ data: { runId: run!.runId } }]);
    expect(
      (await boss.getJobById(MEMORY_EXTRACTION_QUEUE, jobId!))?.retryCount,
    ).toBe(4);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(
      "private-provider-id",
    );
    expect(logger.error).toHaveBeenCalledTimes(5);
  } finally {
    await stop?.();
    await boss.offWork(MEMORY_EXTRACTION_QUEUE);
    await boss.deleteAllJobs(MEMORY_EXTRACTION_QUEUE);
    await boss.deleteAllJobs(MEMORY_EXTRACTION_DEAD_LETTER_QUEUE);
    await database.$client.end();
  }
}, 35_000);

test("lost replacement jobs with divergent retry clocks publish exactly one durable dead letter", async () => {
  const database = createDatabase(testDatabaseUrl());
  let stop: (() => Promise<void>) | undefined;
  try {
    await resetExtractionDatabase(database);
    await boss.deleteAllJobs(MEMORY_EXTRACTION_QUEUE);
    await boss.deleteAllJobs(MEMORY_EXTRACTION_DEAD_LETTER_QUEUE);
    const fixture = await extractionFixture(database);
    const attempt = await extractionAttempt(database, fixture);
    const run = await database.transaction((tx) =>
      createExtractionRunForCompletedAttempt(tx, {
        ...fixture,
        ...attempt,
        now: extractionNow,
      }),
    );
    let calls = 0;
    stop = await registerMemoryExtractionWorker(
      database,
      boss,
      extractionGateway(async () => {
        calls++;
        throw new ModelGatewayError("server", { retryable: true });
      }),
      extractionCounter,
      { error: vi.fn() },
    );
    for (let count = 1; count <= 5; count++) {
      await expect
        .poll(
          async () => {
            const [row] = await database.select().from(memoryExtractionRun);
            return { count: row.attemptCount, status: row.status };
          },
          { timeout: 6_000 },
        )
        .toEqual({ count, status: count < 5 ? "retrying" : "dead_letter" });
      const [row] = await database.select().from(memoryExtractionRun);
      await expect
        .poll(
          async () =>
            (await boss.getJobById(MEMORY_EXTRACTION_QUEUE, row.jobId!))?.state,
          { timeout: 6_000 },
        )
        .toBe(count < 5 ? "retry" : "completed");
      expect(
        (await boss.getJobById(MEMORY_EXTRACTION_QUEUE, row.jobId!))
          ?.retryCount,
      ).toBe(0);
      if (count < 5) {
        await boss.deleteAllJobs(MEMORY_EXTRACTION_QUEUE);
        await database
          .update(memoryExtractionRun)
          .set({ nextRetryAt: new Date(0) });
        await enqueuePendingExtractionRuns(database, boss, new Date());
      }
    }
    await Promise.all([
      enqueuePendingExtractionRuns(database, boss, new Date()),
      enqueuePendingExtractionRuns(database, boss, new Date()),
    ]);
    const letters = await boss.findJobs<{ runId: string }>(
      MEMORY_EXTRACTION_DEAD_LETTER_QUEUE,
      { data: { runId: run!.runId } },
    );
    expect(letters).toHaveLength(1);
    expect(letters[0].data).toEqual({ runId: run!.runId });
    expect(calls).toBe(5);
    expect(await database.select().from(usageLedger)).toHaveLength(5);
  } finally {
    await stop?.();
    await boss.offWork(MEMORY_EXTRACTION_QUEUE);
    await boss.deleteAllJobs(MEMORY_EXTRACTION_QUEUE);
    await boss.deleteAllJobs(MEMORY_EXTRACTION_DEAD_LETTER_QUEUE);
    await database.$client.end();
  }
}, 40_000);

test("database-terminal recovery atomically publishes with its marker and safely retries publication errors", async () => {
  const database = createDatabase(testDatabaseUrl());
  const logger = { error: vi.fn() };
  let stop: (() => Promise<void>) | undefined;
  let trigger = false;
  try {
    await resetExtractionDatabase(database);
    await boss.deleteAllJobs(MEMORY_EXTRACTION_QUEUE);
    await boss.deleteAllJobs(MEMORY_EXTRACTION_DEAD_LETTER_QUEUE);
    const fixture = await extractionFixture(database);
    const attempt = await extractionAttempt(database, fixture);
    const run = await database.transaction((tx) =>
      createExtractionRunForCompletedAttempt(tx, {
        ...fixture,
        ...attempt,
        now: extractionNow,
      }),
    );
    const gateway = extractionGateway(async () => {
      throw new ModelGatewayError("server", { retryable: true });
    });
    for (let count = 0; count < 5; count++) {
      await database
        .update(memoryExtractionRun)
        .set({ nextRetryAt: new Date(0) });
      await expect(
        processMemoryExtractionRun(
          database,
          gateway,
          extractionCounter,
          run!.runId,
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ category: "server" });
    }
    await database.execute(
      sql.raw(`
      CREATE FUNCTION task5_fix_publication_fail() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'fixture-private-publication-body'; END $$;
      CREATE TRIGGER task5_fix_publication_fail BEFORE UPDATE OF dead_letter_published_at
      ON memory_extraction_runs FOR EACH ROW EXECUTE FUNCTION task5_fix_publication_fail()
    `),
    );
    trigger = true;
    stop = await registerMemoryExtractionWorker(
      database,
      boss,
      gateway,
      extractionCounter,
      logger,
    );
    expect(await boss.findJobs(MEMORY_EXTRACTION_DEAD_LETTER_QUEUE)).toEqual(
      [],
    );
    expect(
      (await database.select().from(memoryExtractionRun))[0]
        .deadLetterPublishedAt,
    ).toBeNull();
    const wakeup = await boss.send(MEMORY_EXTRACTION_QUEUE, {
      runId: run!.runId,
    });
    await expect
      .poll(
        async () =>
          (await boss.getJobById(MEMORY_EXTRACTION_QUEUE, wakeup!))?.state,
        { timeout: 6_000 },
      )
      .toBe("retry");
    expect(
      JSON.stringify(
        (await boss.getJobById(MEMORY_EXTRACTION_QUEUE, wakeup!))?.output,
      ),
    ).not.toContain("fixture-private-publication-body");
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(
      "fixture-private-publication-body",
    );
    await database.execute(
      sql.raw(
        "DROP TRIGGER task5_fix_publication_fail ON memory_extraction_runs; DROP FUNCTION task5_fix_publication_fail()",
      ),
    );
    trigger = false;
    await enqueuePendingExtractionRuns(database, boss, new Date());
    expect(
      await boss.findJobs(MEMORY_EXTRACTION_DEAD_LETTER_QUEUE),
    ).toHaveLength(1);
    expect(
      (await database.select().from(memoryExtractionRun))[0]
        .deadLetterPublishedAt,
    ).toBeInstanceOf(Date);
    await expect(
      database.update(memoryExtractionRun).set({ deadLetterPublishedAt: null }),
    ).rejects.toThrow();
    await boss.deleteAllJobs(MEMORY_EXTRACTION_DEAD_LETTER_QUEUE);
    await enqueuePendingExtractionRuns(database, boss, new Date());
    expect(await boss.findJobs(MEMORY_EXTRACTION_DEAD_LETTER_QUEUE)).toEqual(
      [],
    );
    expect(await database.select().from(usageLedger)).toHaveLength(5);
  } finally {
    if (trigger)
      await database.execute(
        sql.raw(
          "DROP TRIGGER task5_fix_publication_fail ON memory_extraction_runs; DROP FUNCTION task5_fix_publication_fail()",
        ),
      );
    await stop?.();
    await boss.offWork(MEMORY_EXTRACTION_QUEUE);
    await boss.deleteAllJobs(MEMORY_EXTRACTION_QUEUE);
    await boss.deleteAllJobs(MEMORY_EXTRACTION_DEAD_LETTER_QUEUE);
    await database.$client.end();
  }
}, 20_000);

test("periodic production reconciler discovers completion after worker startup without an immediate send", async () => {
  const database = createDatabase(testDatabaseUrl());
  let stop: (() => Promise<void>) | undefined;
  try {
    await resetExtractionDatabase(database);
    await boss.deleteAllJobs(MEMORY_EXTRACTION_QUEUE);
    const fixture = await extractionFixture(database);
    const attempt = await extractionAttempt(database, fixture);
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    stop = await registerMemoryExtractionWorker(
      database,
      boss,
      extractionGateway(async () =>
        extractionResult([extractionCandidate(attempt.sourceMessageId)]),
      ),
      extractionCounter,
      { error: vi.fn() },
    );
    const run = await database.transaction((tx) =>
      createExtractionRunForCompletedAttempt(tx, {
        ...fixture,
        ...attempt,
        now: extractionNow,
      }),
    );
    expect(
      (await database.select().from(memoryExtractionRun))[0].jobId,
    ).toBeNull();
    await vi.advanceTimersByTimeAsync(30_000);
    await expect
      .poll(
        async () =>
          (await database.select().from(memoryExtractionRun))[0].status,
        { timeout: 6_000 },
      )
      .toBe("complete");
    expect((await database.select().from(memoryExtractionRun))[0].id).toBe(
      run!.runId,
    );
  } finally {
    await stop?.();
    vi.useRealTimers();
    await boss.offWork(MEMORY_EXTRACTION_QUEUE);
    await boss.deleteAllJobs(MEMORY_EXTRACTION_QUEUE);
    await database.$client.end();
  }
});

test("real worker CLI applies configured summary limits while processing extraction, summary and auth jobs", async () => {
  const database = createDatabase(testDatabaseUrl());
  const configPath = `.task6-worker-config-${process.pid}.yml`;
  let child: ReturnType<typeof spawn> | undefined;
  let exit: Promise<unknown> | undefined;
  let output = "";
  let calls = 0;
  let schemaType: unknown;
  let summaryMaxLength: unknown;
  await resetExtractionDatabase(database);
  const owner = await extractionFixture(database);
  const attempt = await extractionAttempt(database, owner);
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    schemaType = body.response_format.json_schema.schema.type;
    if (body.response_format.json_schema.schema.required.includes("summary"))
      summaryMaxLength =
        body.response_format.json_schema.schema.properties.summary.maxLength;
    calls++;
    response.writeHead(200, {
      "content-type": "application/json",
      "x-request-id": "cli-provider-fixture",
    });
    response.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content:
                body.response_format.json_schema.schema.required.includes(
                  "summary",
                )
                  ? JSON.stringify({ summary: "x".repeat(100) })
                  : extractionResult([
                      extractionCandidate(attempt.sourceMessageId),
                    ]).content,
            },
          },
        ],
        usage: { prompt_tokens: 13, completion_tokens: 7 },
      }),
    );
  });
  try {
    await writeFile(
      configPath,
      (await readFile("app.config.yml", "utf8")).replace(
        "maxSummaryCharacters: 4000",
        "maxSummaryCharacters: 100",
      ),
    );
    await boss.offWork(AUTH_EMAIL_QUEUE);
    await boss.deleteAllJobs(AUTH_EMAIL_QUEUE);
    await boss.deleteAllJobs(MEMORY_EXTRACTION_QUEUE);
    await boss.deleteAllJobs(RELATIONSHIP_SUMMARY_QUEUE);
    await database.transaction((tx) =>
      createExtractionRunForCompletedAttempt(tx, {
        ...owner,
        ...attempt,
        now: extractionNow,
      }),
    );
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing local provider port.");
    const manifest = JSON.parse(await readFile("package.json", "utf8"));
    child = spawn(
      process.execPath,
      manifest.scripts.worker.split(" ").slice(1),
      {
        env: {
          ...process.env,
          ...validSecretEnv,
          APP_CONFIG_PATH: `${process.cwd()}/${configPath}`,
          DATABASE_URL: testDatabaseUrl(),
          MODEL_API_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
          MODEL_ID: "test-model",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child.stdout?.on("data", (value: Buffer) => {
      output += value.toString();
    });
    child.stderr?.on("data", (value: Buffer) => {
      output += value.toString();
    });
    exit = once(child, "exit").then(([code]) => code);
    void exit.catch(() => undefined);
    await expect
      .poll(
        async () =>
          (await database.select().from(memoryExtractionRun))[0].status,
        { timeout: 10_000 },
      )
      .toBe("complete");
    await enqueuePendingSummaryRuns(database, boss, new Date());
    await expect
      .poll(
        async () =>
          (await database.select().from(relationshipSummaryRun))[0]?.status,
        { timeout: 6000 },
      )
      .toBe("complete");
    const authJob = await boss.send(AUTH_EMAIL_QUEUE, { kind: "noop" });
    await expect
      .poll(
        async () => (await boss.getJobById(AUTH_EMAIL_QUEUE, authJob!))?.state,
        { timeout: 6_000 },
      )
      .toBe("completed");
    expect(calls).toBe(2);
    expect(schemaType).toBe("object");
    expect(summaryMaxLength).toBe(100);
    expect(await database.select().from(memoryItem)).toHaveLength(1);
    expect(
      (await database.select().from(relationshipSummaryVersion))[0]?.content,
    ).toBe("x".repeat(100));
    expect(await database.select().from(usageLedger)).toMatchObject([
      { inputTokens: 13, outputTokens: 7 },
      { inputTokens: 13, outputTokens: 7 },
    ]);
    child.kill("SIGTERM");
    await expect(exit).resolves.toBe(0);
    expect(output).not.toContain(validSecretEnv.MODEL_API_KEY);
    expect(output).not.toContain("Likes green tea.");
    expect(output).not.toContain("Enjoys green tea.");
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      let timeout: NodeJS.Timeout | undefined;
      await Promise.race([
        exit,
        new Promise<void>((resolve) => {
          timeout = setTimeout(resolve, 3_000);
        }),
      ]);
      if (timeout) clearTimeout(timeout);
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
      await exit;
    }
    if (server.listening)
      await new Promise<void>((resolve) => server.close(() => resolve()));
    await boss.deleteAllJobs(MEMORY_EXTRACTION_QUEUE);
    await boss.deleteAllJobs(RELATIONSHIP_SUMMARY_QUEUE);
    await boss.deleteAllJobs(RELATIONSHIP_SUMMARY_DEAD_LETTER_QUEUE);
    await database.$client.end();
    await unlink(configPath).catch(() => undefined);
  }
}, 25_000);
