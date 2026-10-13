import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import {
  conversationMessage,
  generationAttempt,
  quotaBucket,
  usageLedger,
} from "../../src/server/db/chat-schema";
import { rateLimit, user } from "../../src/server/db/auth-schema";
import {
  bootstrapAdmin,
  cleanupAdminTestData,
  createAdminTestDatabase,
} from "./support/admin";
import {
  fakeModelRequests,
  registerAndSignIn,
  resetFakeModel,
  sendChatMessage,
  setFakeModelControl,
  startCharacterConversation,
} from "./support/chat";
import { e2eEnvironment } from "./support/environment";

interface ChatResult {
  status: number;
  contentType: string;
  body: unknown;
}

interface CapturedChatResponse {
  rawBody: string;
  result: ChatResult;
}

async function postChat(
  page: Page,
  conversationId: string,
  content: string,
  capturedResponses: CapturedChatResponse[],
): Promise<ChatResult> {
  const captured = await page.evaluate(
    async ({ conversationId: id, content: message }) => {
      const response = await fetch(`/api/chat/conversations/${id}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientRequestId: crypto.randomUUID(),
          content: message,
        }),
      });
      const contentType = response.headers.get("content-type") ?? "";
      const text = await response.text();
      return {
        status: response.status,
        contentType,
        rawBody: text,
        body: contentType.includes("application/json")
          ? JSON.parse(text)
          : text
              .trim()
              .split("\n")
              .filter(Boolean)
              .map((line) => JSON.parse(line)),
      };
    },
    { conversationId, content },
  );
  const { rawBody, ...result } = captured;
  capturedResponses.push({ rawBody, result });
  return result;
}

function terminalEvent(result: ChatResult) {
  expect(result.status).toBe(200);
  expect(result.contentType).toContain("application/x-ndjson");
  const events = result.body as Array<Record<string, unknown>>;
  return events.at(-1);
}

function expectFailedStream(
  result: ChatResult,
  terminal: Record<string, unknown>,
): void {
  expect(result.status).toBe(200);
  expect(result.contentType).toContain("application/x-ndjson");
  const events = result.body as Array<Record<string, unknown>>;
  expect(events).toHaveLength(2);
  const attemptId = events[0]?.attemptId;
  expect(attemptId).toEqual(expect.any(String));
  expect(events).toEqual([
    { type: "started", attemptId },
    { type: "failed", attemptId, ...terminal },
  ]);
}

function expectInterruptedStream(result: ChatResult): void {
  expect(result.status).toBe(200);
  expect(result.contentType).toContain("application/x-ndjson");
  const events = result.body as Array<Record<string, unknown>>;
  expect(events).toHaveLength(3);
  const attemptId = events[0]?.attemptId;
  expect(attemptId).toEqual(expect.any(String));
  expect(events).toEqual([
    { type: "started", attemptId },
    { type: "delta", attemptId, text: "Partial reply" },
    {
      type: "interrupted",
      attemptId,
      code: "CHAT_STREAM_INTERRUPTED",
      message: "The response stream ended before completion.",
      retryable: true,
    },
  ]);
}

function expectProviderSecretsAbsent(values: unknown[]): void {
  const serialized = values
    .map((value) => (typeof value === "string" ? value : JSON.stringify(value)))
    .join("\n");
  for (const secret of [
    e2eEnvironment.MODEL_API_KEY,
    e2eEnvironment.MODEL_API_BASE_URL,
  ]) {
    expect(serialized).not.toContain(secret);
  }
}

async function setGlobalSettings(
  page: Page,
  settings: {
    userRequests: number;
    userTokens: number;
    instanceRequests: number;
    instanceTokens: number;
    concurrency?: number;
  },
) {
  await page.goto("/admin/usage");
  await page
    .getByLabel("User daily request limit", { exact: true })
    .fill(String(settings.userRequests));
  await page
    .getByLabel("User daily token limit", { exact: true })
    .fill(String(settings.userTokens));
  await page
    .getByLabel("Instance monthly request limit", { exact: true })
    .fill(String(settings.instanceRequests));
  await page
    .getByLabel("Instance monthly token budget", { exact: true })
    .fill(String(settings.instanceTokens));
  await page
    .getByLabel("Maximum concurrent generations", { exact: true })
    .fill(String(settings.concurrency ?? 4));
  await page
    .getByRole("button", { name: "Save chat settings", exact: true })
    .click();
  await expect(
    page.getByText("Chat settings updated.", { exact: true }),
  ).toBeVisible();
}

async function setUserOverride(
  page: Page,
  input: { email: string; name: string; requests: number; tokens: number },
) {
  await page.goto(`/admin/users?q=${encodeURIComponent(input.email)}`);
  const form = page.getByRole("form", {
    name: `Quota override for ${input.name}`,
  });
  await form
    .getByLabel("Daily request override", { exact: true })
    .fill(String(input.requests));
  await form
    .getByLabel("Daily token override", { exact: true })
    .fill(String(input.tokens));
  await form
    .getByRole("button", { name: "Save quota override", exact: true })
    .click();
  await expect(form.getByRole("status")).toContainText(
    "User quota override updated.",
  );
}

async function usageTotals(
  database: ReturnType<typeof createAdminTestDatabase>,
  periodStart: Date,
) {
  const [totals] = await database
    .select({
      requests: sql<number>`coalesce(sum(${usageLedger.userRequestUnits}), 0)::int`,
      inputTokens: sql<number>`coalesce(sum(${usageLedger.inputTokens}), 0)::int`,
      outputTokens: sql<number>`coalesce(sum(${usageLedger.outputTokens}), 0)::int`,
      estimated: sql<number>`count(*) filter (where ${usageLedger.usageIsEstimated})::int`,
    })
    .from(usageLedger)
    .where(gte(usageLedger.periodStart, periodStart));
  return {
    requests: Number(totals?.requests ?? 0),
    inputTokens: Number(totals?.inputTokens ?? 0),
    outputTokens: Number(totals?.outputTokens ?? 0),
    estimated: Number(totals?.estimated ?? 0),
  };
}

function utcDayStart(now = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

function utcMonthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

async function instanceQuotaConsumption(
  database: ReturnType<typeof createAdminTestDatabase>,
) {
  const [bucket] = await database
    .select({
      requests: quotaBucket.consumedRequests,
      tokens: quotaBucket.consumedTokens,
    })
    .from(quotaBucket)
    .where(
      and(
        eq(quotaBucket.scope, "instance"),
        eq(quotaBucket.periodStart, utcMonthStart()),
      ),
    )
    .limit(1);
  return {
    requests: Number(bucket?.requests ?? 0),
    tokens: Number(bucket?.tokens ?? 0),
  };
}

async function userUsageTotals(
  database: ReturnType<typeof createAdminTestDatabase>,
  email: string,
) {
  const [totals] = await database
    .select({
      requests: sql<number>`coalesce(sum(${usageLedger.userRequestUnits}), 0)::int`,
      tokens: sql<number>`coalesce(sum(${usageLedger.inputTokens} + ${usageLedger.outputTokens}), 0)::int`,
    })
    .from(usageLedger)
    .innerJoin(user, eq(user.id, usageLedger.userId))
    .where(eq(user.email, email));
  return {
    requests: Number(totals?.requests ?? 0),
    tokens: Number(totals?.tokens ?? 0),
  };
}

async function staticAssetText(directory: string): Promise<string> {
  const entries = await readdir(directory, { withFileTypes: true });
  const values = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(directory, entry.name);
      return entry.isDirectory()
        ? staticAssetText(target)
        : readFile(target, "utf8");
    }),
  );
  return values.join("\n");
}

test("enforces tenant isolation, distinct quotas, provider failures and aggregate privacy", async ({
  browser,
  page: adminPage,
}) => {
  test.setTimeout(180_000);
  const database = createAdminTestDatabase(e2eEnvironment.TEST_DATABASE_URL!);
  const token = randomUUID();
  const adminEmail = `quota-admin-${token}@example.com`;
  const userAEmail = `quota-a-${token}@example.com`;
  const userBEmail = `quota-b-${token}@example.com`;
  const decisiveUserEmail = `quota-decisive-${token}@example.com`;
  const userAName = `Quota A ${token}`;
  const userBName = `Quota B ${token}`;
  const userAContext = await browser.newContext({
    baseURL: e2eEnvironment.BETTER_AUTH_URL,
  });
  const userBContext = await browser.newContext({
    baseURL: e2eEnvironment.BETTER_AUTH_URL,
  });
  const decisiveUserContext = await browser.newContext({
    baseURL: e2eEnvironment.BETTER_AUTH_URL,
  });
  const userAPage = await userAContext.newPage();
  const userBPage = await userBContext.newPage();
  const decisiveUserPage = await decisiveUserContext.newPage();
  const chatResponses: CapturedChatResponse[] = [];
  const providerSecretScanValues: unknown[] = [chatResponses];
  let adminReady = false;

  try {
    await resetFakeModel();
    await database.delete(rateLimit);
    await bootstrapAdmin(
      adminPage,
      adminEmail,
      "correct horse battery staple",
      database,
    );
    adminReady = true;
    await setGlobalSettings(adminPage, {
      userRequests: 100,
      userTokens: 100_000,
      instanceRequests: 10_000,
      instanceTokens: 10_000_000,
    });
    await registerAndSignIn(userAPage, {
      email: userAEmail,
      name: userAName,
    });
    await registerAndSignIn(userBPage, {
      email: userBEmail,
      name: userBName,
    });
    await registerAndSignIn(decisiveUserPage, {
      email: decisiveUserEmail,
      name: `Quota decisive ${token}`,
    });
    const userAConversation = await startCharacterConversation(
      userAPage,
      "calm-listener",
    );
    const userBConversation = await startCharacterConversation(
      userBPage,
      "calm-listener",
    );
    const decisiveUserConversation = await startCharacterConversation(
      decisiveUserPage,
      "calm-listener",
    );

    const forbiddenPage = await userBPage.goto(
      `/app/conversations/${userAConversation}`,
    );
    expect(forbiddenPage?.status()).toBe(404);
    providerSecretScanValues.push(await forbiddenPage!.text());
    const forbiddenStream = await postChat(
      userBPage,
      userAConversation,
      "Cross-user streamed event attempt [stream]",
      chatResponses,
    );
    expect(forbiddenStream).toEqual({
      status: 404,
      contentType: "application/json",
      body: {
        error: {
          code: "CHAT_NOT_FOUND",
          message: "The requested chat was not found.",
          retryable: false,
        },
      },
    });

    await userAPage.goto(`/app/conversations/${userAConversation}`);
    await sendChatMessage(userAPage, "Cross-user stop attempt [stall]");
    await expect(
      userAPage.locator('li[data-status="streaming"]').last(),
    ).toContainText("Partial reply");
    const [activeAttempt] = await database
      .select({ id: generationAttempt.id })
      .from(generationAttempt)
      .innerJoin(
        conversationMessage,
        eq(conversationMessage.id, generationAttempt.assistantMessageId),
      )
      .where(
        and(
          eq(conversationMessage.conversationId, userAConversation),
          eq(generationAttempt.isCurrent, true),
        ),
      )
      .orderBy(desc(generationAttempt.createdAt))
      .limit(1);
    expect(activeAttempt?.id).toBeTruthy();
    const forbiddenStop = await userBPage.evaluate(async (attemptId) => {
      const response = await fetch(`/api/chat/attempts/${attemptId}/stop`, {
        method: "POST",
      });
      return { status: response.status, body: await response.json() };
    }, activeAttempt!.id);
    providerSecretScanValues.push(forbiddenStop.body);
    expect(forbiddenStop).toEqual({
      status: 404,
      body: {
        error: {
          code: "CHAT_NOT_FOUND",
          message: "The requested chat was not found.",
          retryable: false,
        },
      },
    });
    await userAPage.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(
      userAPage.locator('li[data-status="interrupted"]').last(),
    ).toContainText("Stopped.");

    await setUserOverride(adminPage, {
      email: userAEmail,
      name: userAName,
      requests: 1,
      tokens: 100_000,
    });
    const userRequestQuota = await postChat(
      userAPage,
      userAConversation,
      "User request quota",
      chatResponses,
    );
    expect(userRequestQuota).toEqual({
      status: 429,
      contentType: "application/json",
      body: {
        error: {
          code: "CHAT_USER_REQUEST_QUOTA",
          message: "You have reached today's chat request limit.",
          retryable: true,
          resetAt: expect.any(String),
        },
      },
    });
    expect(
      terminalEvent(
        await postChat(
          userBPage,
          userBConversation,
          "User B unaffected [stream]",
          chatResponses,
        ),
      ),
    ).toMatchObject({ type: "completed" });

    await setUserOverride(adminPage, {
      email: userAEmail,
      name: userAName,
      requests: 100,
      tokens: 1,
    });
    const userTokenQuota = await postChat(
      userAPage,
      userAConversation,
      "User token quota",
      chatResponses,
    );
    expect(userTokenQuota).toEqual({
      status: 429,
      contentType: "application/json",
      body: {
        error: {
          code: "CHAT_USER_TOKEN_QUOTA",
          message: "You have reached today's chat token limit.",
          retryable: true,
          resetAt: expect.any(String),
        },
      },
    });
    expect(
      (userRequestQuota.body as { error: { resetAt: string } }).error.resetAt,
    ).toBe(
      (userTokenQuota.body as { error: { resetAt: string } }).error.resetAt,
    );

    const beforeInstanceRequestExhaustion =
      await instanceQuotaConsumption(database);
    await setGlobalSettings(adminPage, {
      userRequests: beforeInstanceRequestExhaustion.requests + 1,
      userTokens: 100_000,
      instanceRequests: beforeInstanceRequestExhaustion.requests + 1,
      instanceTokens: 10_000_000,
    });
    expect(
      terminalEvent(
        await postChat(
          userBPage,
          userBConversation,
          "Exhaust instance request budget [stream]",
          chatResponses,
        ),
      ),
    ).toMatchObject({ type: "completed" });
    expect((await instanceQuotaConsumption(database)).requests).toBe(
      beforeInstanceRequestExhaustion.requests + 1,
    );
    const instanceRequestBudget = await postChat(
      decisiveUserPage,
      decisiveUserConversation,
      "Decisive instance request budget",
      chatResponses,
    );
    expect(instanceRequestBudget).toEqual({
      status: 429,
      contentType: "application/json",
      body: {
        error: {
          code: "CHAT_INSTANCE_REQUEST_BUDGET",
          message: "This deployment has reached its request budget.",
          retryable: true,
          resetAt: expect.any(String),
        },
      },
    });
    expect(await userUsageTotals(database, decisiveUserEmail)).toEqual({
      requests: 0,
      tokens: 0,
    });

    await setGlobalSettings(adminPage, {
      userRequests: 100,
      userTokens: 100_000,
      instanceRequests: 100_000,
      instanceTokens: 10_000_000,
    });
    expect(
      terminalEvent(
        await postChat(
          userBPage,
          userBConversation,
          "Exhaust instance token budget [stream]",
          chatResponses,
        ),
      ),
    ).toMatchObject({ type: "completed" });
    const exhaustedInstanceTokens = (await instanceQuotaConsumption(database))
      .tokens;
    await setGlobalSettings(adminPage, {
      userRequests: 100,
      userTokens: exhaustedInstanceTokens,
      instanceRequests: 100_000,
      instanceTokens: exhaustedInstanceTokens,
    });
    const instanceTokenBudget = await postChat(
      decisiveUserPage,
      decisiveUserConversation,
      "Decisive instance token budget",
      chatResponses,
    );
    expect(instanceTokenBudget).toEqual({
      status: 429,
      contentType: "application/json",
      body: {
        error: {
          code: "CHAT_INSTANCE_TOKEN_BUDGET",
          message: "This deployment has reached its token budget.",
          retryable: true,
          resetAt: expect.any(String),
        },
      },
    });
    expect(await userUsageTotals(database, decisiveUserEmail)).toEqual({
      requests: 0,
      tokens: 0,
    });
    expect(
      (instanceRequestBudget.body as { error: { resetAt: string } }).error
        .resetAt,
    ).toBe(
      (instanceTokenBudget.body as { error: { resetAt: string } }).error
        .resetAt,
    );
    expect(
      (instanceTokenBudget.body as { error: { resetAt: string } }).error
        .resetAt,
    ).not.toBe(
      (userTokenQuota.body as { error: { resetAt: string } }).error.resetAt,
    );

    await setGlobalSettings(adminPage, {
      userRequests: 100,
      userTokens: 100_000,
      instanceRequests: 100_000,
      instanceTokens: 10_000_000,
    });
    const providerRateLimit = await postChat(
      userBPage,
      userBConversation,
      "Provider rate [rate-limit]",
      chatResponses,
    );
    expectFailedStream(providerRateLimit, {
      code: "CHAT_PROVIDER_RATE_LIMIT",
      message: "The model provider is rate limiting requests.",
      retryable: true,
      resetAt: expect.any(String),
    });
    const providerAuth = await postChat(
      userBPage,
      userBConversation,
      "Provider auth [auth-fail]",
      chatResponses,
    );
    expectFailedStream(providerAuth, {
      code: "CHAT_PROVIDER_AUTH",
      message: "The model provider rejected the request.",
      retryable: false,
    });
    const providerTimeout = await postChat(
      userBPage,
      userBConversation,
      "Provider timeout [slow]",
      chatResponses,
    );
    expectFailedStream(providerTimeout, {
      code: "CHAT_PROVIDER_TIMEOUT",
      message: "The model provider took too long to respond.",
      retryable: true,
    });
    const interrupted = await postChat(
      userBPage,
      userBConversation,
      "Provider interruption [interrupt]",
      chatResponses,
    );
    expectInterruptedStream(interrupted);

    await resetFakeModel();
    const beforeAggregate = await usageTotals(database, utcMonthStart());
    const privacyPhrase = `private-message-${randomUUID()}`;
    expect(
      terminalEvent(
        await postChat(
          userBPage,
          userBConversation,
          `${privacyPhrase} [stream]`,
          chatResponses,
        ),
      ),
    ).toMatchObject({ type: "completed" });
    const providerActivity = await fakeModelRequests();
    expect(providerActivity).toHaveLength(1);
    const afterAggregate = await usageTotals(database, utcMonthStart());
    expect(afterAggregate).toMatchObject({
      requests: beforeAggregate.requests + 1,
      inputTokens: beforeAggregate.inputTokens + 20,
      outputTokens: beforeAggregate.outputTokens + 2,
    });

    await setFakeModelControl({ missingUsage: true });
    const beforeEstimated = await usageTotals(database, utcMonthStart());
    expect(
      terminalEvent(
        await postChat(
          userBPage,
          userBConversation,
          "Missing provider usage [stream]",
          chatResponses,
        ),
      ),
    ).toMatchObject({ type: "completed" });
    const afterEstimated = await usageTotals(database, utcMonthStart());
    expect(afterEstimated.estimated).toBe(beforeEstimated.estimated + 1);
    await setFakeModelControl({ missingUsage: false });

    const finalDayTotals = await usageTotals(database, utcDayStart());
    const finalMonthTotals = await usageTotals(database, utcMonthStart());
    expect(finalMonthTotals).toEqual(afterEstimated);
    await adminPage.goto("/admin/usage");
    const usageHtml = await adminPage.content();
    await expect(
      adminPage.getByRole("heading", { name: "Usage and quotas" }),
    ).toBeVisible();
    const dayCard = adminPage
      .getByRole("heading", { name: "UTC day", exact: true })
      .locator("..");
    await expect(
      dayCard.getByText(`${finalDayTotals.requests} requests`, {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      dayCard.getByText(
        `${finalDayTotals.inputTokens} input / ${finalDayTotals.outputTokens} output tokens`,
        { exact: true },
      ),
    ).toBeVisible();
    const monthCard = adminPage
      .getByRole("heading", { name: "UTC month", exact: true })
      .locator("..");
    await expect(
      monthCard.getByText(`${finalMonthTotals.requests} requests`, {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      monthCard.getByText(
        `${finalMonthTotals.inputTokens} input / ${finalMonthTotals.outputTokens} output tokens`,
        { exact: true },
      ),
    ).toBeVisible();
    await adminPage.goto("/admin/audit");
    const auditHtml = await adminPage.content();
    const applicationLogs = await readFile("test-results/e2e-app.log", "utf8");
    for (const source of [usageHtml, auditHtml, applicationLogs]) {
      expect(source).not.toContain(privacyPhrase);
    }

    const browserBodies = [
      usageHtml,
      auditHtml,
      await (await adminPage.request.get("/")).text(),
      await (
        await userBPage.request.get(`/app/conversations/${userBConversation}`)
      ).text(),
    ].join("\n");
    const staticAssets = await staticAssetText(".next/static");
    expect(chatResponses).toHaveLength(14);
    const ndjsonResponses = chatResponses.filter(({ result }) =>
      result.contentType.includes("application/x-ndjson"),
    );
    expect(ndjsonResponses).toHaveLength(9);
    for (const { rawBody, result } of ndjsonResponses) {
      expect(
        rawBody
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line)),
      ).toEqual(result.body);
    }
    expect(
      ndjsonResponses.filter(({ result }) => {
        const events = result.body as Array<Record<string, unknown>>;
        return events.at(-1)?.type === "completed";
      }),
    ).toHaveLength(5);
    providerSecretScanValues.push(browserBodies, staticAssets);
    expectProviderSecretsAbsent(providerSecretScanValues);
  } finally {
    if (adminReady) {
      try {
        await adminPage.goto("/admin/usage");
        await adminPage
          .getByText("Restore the stored deployment defaults.")
          .click();
        await adminPage
          .getByRole("button", {
            name: "Reset to deployment defaults",
            exact: true,
          })
          .click();
        await expect(adminPage.getByRole("status")).toContainText(
          "Deployment defaults restored.",
        );
      } catch {
        // Preserve the original acceptance failure.
      }
    }
    await userAContext.close();
    await userBContext.close();
    await decisiveUserContext.close();
    try {
      await cleanupAdminTestData(
        database,
        [adminEmail, userAEmail, userBEmail, decisiveUserEmail],
        [],
      );
    } finally {
      await database.$client.end();
    }
  }
});
