import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { and, eq, max, sql } from "drizzle-orm";
import {
  conversation,
  conversationMessage,
  generationAttempt,
  generationLease,
  quotaBucket,
  quotaReservation,
  usageLedger,
} from "../../src/server/db/chat-schema";
import { createAdminTestDatabase } from "./support/admin";
import { e2eEnvironment } from "./support/environment";
import {
  fakeModelBaseUrl,
  fakeModelRequests,
  registerAndSignIn,
  resetFakeModel,
  sendChatMessage,
  startCharacterConversation,
} from "./support/chat";

async function assertLiveComposerReplayRecovery(
  page: Page,
  database: ReturnType<typeof createAdminTestDatabase>,
  conversationId: string,
) {
  const content = "Lost before started while active [replay-recovery]";
  const bodies: Array<{ clientRequestId: string; content: string }> = [];
  let admittedResponse: Response | undefined;
  const messageRoute = "**/api/chat/conversations/*/messages";
  await page.unroute(messageRoute);
  await page.route(messageRoute, async (route) => {
    bodies.push(route.request().postDataJSON());
    if (bodies.length === 1) {
      admittedResponse = await fetch(route.request().url(), {
        method: "POST",
        headers: await route.request().allHeaders(),
        body: route.request().postData(),
      });
      expect(admittedResponse.status).toBe(200);
      await route.abort("failed");
    } else {
      await route.continue();
    }
  });
  try {
    await sendChatMessage(page, content);
    await expect(
      page.getByRole("region", { name: "Conversation" }).getByRole("alert"),
    ).toContainText("Unable to reach the chat service.");
    await expect(page.getByLabel("Message", { exact: true })).toHaveValue(
      content,
    );
    await expect
      .poll(async () => {
        const [attempt] = await database
          .select({ content: generationAttempt.content })
          .from(generationAttempt)
          .innerJoin(
            conversationMessage,
            eq(conversationMessage.id, generationAttempt.assistantMessageId),
          )
          .where(eq(conversationMessage.conversationId, conversationId))
          .orderBy(sql`${generationAttempt.createdAt} desc`)
          .limit(1);
        return attempt?.content;
      })
      .toBe("Recovery partial");
    const replayResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/conversations/${conversationId}/messages`) &&
        response.status() === 409,
    );
    await page.getByRole("button", { name: "Send", exact: true }).click();
    const replay = await (await replayResponse).json();
    expect(replay.error).toMatchObject({
      code: "CHAT_GENERATION_IN_PROGRESS",
      metadata: { conversationId },
    });
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toEqual(bodies[0]);
    await expect(page.getByLabel("Message", { exact: true })).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Stop", exact: true }),
    ).toBeVisible();
    await expect(
      page.locator('li[data-status="streaming"]').last(),
    ).toContainText("Recovery partial");

    const providerCalls = (await fakeModelRequests()).filter(
      (request) => request.body.messages?.at(-1)?.content === content,
    );
    expect(providerCalls).toHaveLength(1);
    const completed = await fetch(`${fakeModelBaseUrl}/__e2e__/control`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ completeRequestId: providerCalls[0]!.id }),
    });
    expect(completed.status).toBe(204);
    expect(await admittedResponse!.text()).toContain('"type":"completed"');
    await expect(
      page.locator('li[data-status="complete"]').last(),
    ).toContainText("Recovery partial and final content", { timeout: 10_000 });
    await expect(page.getByLabel("Message", { exact: true })).toBeEnabled();
    await expect(page.getByLabel("Message", { exact: true })).toHaveValue("");
    await expect(page.getByText(content, { exact: true })).toHaveCount(1);
    await expect(
      page.getByText("Recovery partial and final content", { exact: true }),
    ).toHaveCount(1);
    await expect(page.getByText("Recovering the active response…")).toHaveCount(
      0,
    );
    expect(bodies).toHaveLength(2);
    expect(
      (await fakeModelRequests()).filter(
        (request) => request.body.messages?.at(-1)?.content === content,
      ),
    ).toHaveLength(1);
    expect(
      await database
        .select()
        .from(conversationMessage)
        .where(
          and(
            eq(conversationMessage.conversationId, conversationId),
            eq(conversationMessage.kind, "user"),
            eq(conversationMessage.content, content),
          ),
        ),
    ).toHaveLength(1);
    expect(
      await database
        .select()
        .from(usageLedger)
        .where(eq(usageLedger.attemptId, replay.error.metadata.attemptId)),
    ).toMatchObject([
      {
        userRequestUnits: 1,
        inputTokens: 20,
        outputTokens: 4,
        outcome: "complete",
      },
    ]);

    await sendChatMessage(page, "Can send again after live replay [stream]");
    await expect(
      page.locator('li[data-status="complete"]').last(),
    ).toContainText("Hello there");
    await expect(page.getByLabel("Message", { exact: true })).toBeEnabled();
    expect(bodies[2]?.clientRequestId).not.toBe(bodies[0]?.clientRequestId);
  } finally {
    await page.unroute(messageRoute);
    if (admittedResponse && !admittedResponse.bodyUsed) {
      await admittedResponse.body?.cancel();
    }
  }
}

async function assertComposerReplayAndCrashRecovery(page: Page) {
  const database = createAdminTestDatabase(e2eEnvironment.DATABASE_URL!);
  try {
    await resetFakeModel();
    const conversationId = await startCharacterConversation(
      page,
      "calm-listener",
    );
    const bodies: Array<{ clientRequestId: string; content: string }> = [];
    await page.route("**/api/chat/conversations/*/messages", async (route) => {
      bodies.push(route.request().postDataJSON());
      if (bodies.length === 1) {
        const accepted = await route.fetch();
        expect(accepted.status()).toBe(200);
        expect(await accepted.text()).toContain('"type":"completed"');
        await route.abort("failed");
      } else {
        await route.continue();
      }
    });
    const content = "Composer ambiguous transport [stream]";
    await sendChatMessage(page, content);
    await expect(
      page.getByRole("region", { name: "Conversation" }).getByRole("alert"),
    ).toContainText("Unable to reach the chat service.");
    await expect(page.getByLabel("Message", { exact: true })).toHaveValue(
      content,
    );
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(
      page.locator('li[data-status="complete"]').last(),
    ).toContainText("Hello there");
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toEqual(bodies[0]);
    await expect(page.getByText(content, { exact: true })).toHaveCount(1);
    await expect(page.getByLabel("Message", { exact: true })).toHaveValue("");
    expect(
      (await fakeModelRequests()).filter((request) =>
        request.body.messages?.some((message) => message.content === content),
      ),
    ).toHaveLength(1);
    const firstUsage = await database
      .select()
      .from(usageLedger)
      .where(eq(usageLedger.conversationId, conversationId));
    expect(firstUsage).toHaveLength(1);
    expect(firstUsage[0]?.userRequestUnits).toBe(1);

    await sendChatMessage(page, "Genuinely new draft [stream]");
    await expect(
      page.getByText("Genuinely new draft [stream]", { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Message", { exact: true })).toBeDisabled();
    await expect(
      page.locator('li[data-status="complete"]').last(),
    ).toContainText("Hello there");
    await expect(page.getByLabel("Message", { exact: true })).toBeEnabled();
    expect(bodies[2]?.clientRequestId).not.toBe(bodies[0]?.clientRequestId);
    await assertLiveComposerReplayRecovery(page, database, conversationId);

    const crashedAttemptId = randomUUID();
    const assistantMessageId = randomUUID();
    const userMessageId = randomUUID();
    const ownerToken = randomUUID();
    await database.transaction(async (transaction) => {
      const [owned] = await transaction
        .select()
        .from(conversation)
        .where(eq(conversation.id, conversationId));
      const [reservation] = await transaction
        .select()
        .from(quotaReservation)
        .where(eq(quotaReservation.conversationId, conversationId))
        .limit(1);
      const [{ sequence }] = await transaction
        .select({ sequence: max(conversationMessage.sequence) })
        .from(conversationMessage)
        .where(eq(conversationMessage.conversationId, conversationId));
      await transaction.insert(conversationMessage).values([
        {
          id: userMessageId,
          conversationId,
          sequence: Number(sequence) + 1,
          role: "user",
          kind: "user",
          content: "Crashed request",
          clientRequestId: randomUUID(),
        },
        {
          id: assistantMessageId,
          conversationId,
          sequence: Number(sequence) + 2,
          role: "assistant",
          kind: "generated",
          inReplyTo: userMessageId,
        },
      ]);
      await transaction.insert(generationAttempt).values({
        id: crashedAttemptId,
        userId: owned!.userId,
        assistantMessageId,
        attemptNumber: 1,
        modelId: "e2e-chat-model",
        status: "streaming",
        content: "Hello",
        inputTokens: 10,
        outputTokens: 0,
        usageIsEstimated: true,
        leaseOwner: ownerToken,
        leaseExpiresAt: new Date("2000-01-01T00:00:00Z"),
      });
      await transaction.insert(quotaReservation).values({
        id: randomUUID(),
        userId: owned!.userId,
        conversationId,
        attemptId: crashedAttemptId,
        userBucketId: reservation!.userBucketId,
        instanceBucketId: reservation!.instanceBucketId,
        reservedTokens: 200,
      });
      await transaction.insert(generationLease).values({
        attemptId: crashedAttemptId,
        userId: owned!.userId,
        ownerToken,
        expiresAt: new Date("2000-01-01T00:00:00Z"),
      });
      for (const id of [
        reservation!.userBucketId,
        reservation!.instanceBucketId,
      ]) {
        await transaction
          .update(quotaBucket)
          .set({
            reservedRequests: sql`${quotaBucket.reservedRequests} + 1`,
            reservedTokens: sql`${quotaBucket.reservedTokens} + 200`,
          })
          .where(eq(quotaBucket.id, id));
      }
    });
    await page.reload();
    const crashedReply = page
      .getByRole("listitem")
      .filter({ hasText: "Crashed request" })
      .locator("xpath=following-sibling::li[1]");
    await expect(crashedReply).toHaveAttribute("data-status", "interrupted");
    await expect(crashedReply).toContainText("Hello");
    await expect(page.getByLabel("Message", { exact: true })).toBeEnabled();
    await page.reload();
    expect(
      await database
        .select()
        .from(usageLedger)
        .where(eq(usageLedger.attemptId, crashedAttemptId)),
    ).toMatchObject([
      {
        inputTokens: 10,
        outputTokens: 2,
        userRequestUnits: 1,
        outcome: "interrupted",
      },
    ]);
    expect(
      await database
        .select()
        .from(generationLease)
        .where(eq(generationLease.attemptId, crashedAttemptId)),
    ).toHaveLength(0);
    expect(
      await database
        .select({
          reservedRequests: quotaBucket.reservedRequests,
          reservedTokens: quotaBucket.reservedTokens,
        })
        .from(quotaBucket)
        .innerJoin(
          quotaReservation,
          and(
            eq(quotaReservation.attemptId, crashedAttemptId),
            eq(quotaBucket.id, quotaReservation.userBucketId),
          ),
        ),
    ).toMatchObject([{ reservedRequests: 0, reservedTokens: 0 }]);
  } finally {
    await database.$client.end();
  }
}

test("streams, interrupts, retries, stops, restores and deletes conversations safely, with composer replay and crash recovery", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await resetFakeModel();
  const email = `chat-${randomUUID()}@example.com`;
  await registerAndSignIn(page, { email });

  await startCharacterConversation(page, "calm-listener");
  const calmConversationUrl = page.url();
  await expect(
    page.getByText(
      "I’m here with you. What would feel easiest to put into words first?",
      { exact: true },
    ),
  ).toBeVisible();
  expect(await fakeModelRequests()).toEqual([]);

  await sendChatMessage(page, "A streaming check [stream]");
  const streamingReply = page.locator('li[data-status="streaming"]').last();
  await expect(streamingReply).toContainText("Hello");
  await expect(streamingReply).not.toContainText("Hello there");
  const completedReply = page.locator('li[data-status="complete"]').last();
  await expect(completedReply).toContainText("Hello there");

  await sendChatMessage(page, "Please recover [interrupt]");
  const interruptedReply = page.locator('li[data-status="interrupted"]').last();
  await expect(interruptedReply).toContainText("Partial reply");
  await expect(interruptedReply).toContainText(
    "The response stream ended before completion.",
  );
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.locator('li[data-status="complete"]').last()).toContainText(
    "Recovered reply",
  );

  await sendChatMessage(page, "Stop this reply [stall]");
  const stoppedUserMessage = page
    .getByRole("listitem")
    .filter({ hasText: "Stop this reply [stall]" });
  const stoppedReply = stoppedUserMessage.locator(
    "xpath=following-sibling::li[1]",
  );
  await expect(stoppedReply).toHaveAttribute("data-status", "streaming");
  await expect(stoppedReply).toContainText("Partial reply");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(stoppedReply).toHaveAttribute("data-status", "interrupted");
  await expect(stoppedReply).toContainText("Partial reply");
  await expect(stoppedReply).toContainText("Stopped.");

  await sendChatMessage(page, "Refresh this reply [stall]");
  const refreshUserMessage = page
    .getByRole("listitem")
    .filter({ hasText: "Refresh this reply [stall]" });
  const refreshReply = refreshUserMessage.locator(
    "xpath=following-sibling::li[1]",
  );
  await expect(refreshReply).toHaveAttribute("data-status", "streaming");
  await expect(refreshReply).toContainText("Partial reply");
  await page.reload();
  await expect
    .poll(
      async () => {
        const status = await refreshReply.getAttribute("data-status");
        if (status === "pending" || status === "streaming") {
          await page.reload();
        }
        return status;
      },
      { timeout: 15_000 },
    )
    .toBe("interrupted");
  await expect(refreshReply).toContainText(
    "The response stream ended before completion.",
  );

  await sendChatMessage(page, "Hold the user lease [stall]");
  await expect(
    page.locator('li[data-status="streaming"]').last(),
  ).toContainText("Partial reply");
  const secondTab = await page.context().newPage();
  try {
    const energeticConversationId = await startCharacterConversation(
      secondTab,
      "energetic-friend",
    );
    await sendChatMessage(secondTab, "This must be rejected [stream]");
    await expect(
      secondTab
        .getByRole("region", { name: "Conversation" })
        .getByRole("alert"),
    ).toContainText("A response is already being generated for this chat.");
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(
      page.locator('li[data-status="interrupted"]').last(),
    ).toContainText("Stopped.");

    const idempotency = await secondTab.evaluate(
      async ({ conversationId }) => {
        const clientRequestId = crypto.randomUUID();
        const request = () =>
          fetch(`/api/chat/conversations/${conversationId}/messages`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              clientRequestId,
              content: "Idempotent browser request [stream]",
            }),
          });
        const first = request();
        await new Promise((resolve) => setTimeout(resolve, 50));
        const duplicate = await request();
        const duplicateBody = await duplicate.json();
        const firstResponse = await first;
        await firstResponse.text();
        return {
          firstStatus: firstResponse.status,
          duplicateStatus: duplicate.status,
          duplicateBody,
        };
      },
      { conversationId: energeticConversationId },
    );
    expect(idempotency.firstStatus).toBe(200);
    expect(idempotency.duplicateStatus).toBe(409);
    expect(idempotency.duplicateBody).toMatchObject({
      error: {
        code: "CHAT_GENERATION_IN_PROGRESS",
        metadata: {
          conversationId: energeticConversationId,
        },
      },
    });
    const idempotentProviderCalls = (await fakeModelRequests()).filter(
      (request) =>
        request.body.messages?.some(
          (message) =>
            message.content === "Idempotent browser request [stream]",
        ),
    );
    expect(idempotentProviderCalls).toHaveLength(1);
  } finally {
    await secondTab.close();
  }

  await page.goto(calmConversationUrl);
  await page
    .getByRole("button", { name: "Open conversation actions", exact: true })
    .click();
  await page.getByText("Archive this conversation and start over.").click();
  await page.getByRole("button", { name: "Start over", exact: true }).click();
  await page.waitForURL((url) => url.href !== calmConversationUrl);
  await expect(page).toHaveURL(/\/app\/conversations\/[0-9a-f-]{36}$/);
  const newConversationUrl = page.url();
  expect(newConversationUrl).not.toBe(calmConversationUrl);

  await page.goto(calmConversationUrl);
  await expect(
    page.getByText("This archived conversation is read-only.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByLabel("Message", { exact: true })).toHaveCount(0);
  await page
    .getByRole("button", { name: "Open conversation actions", exact: true })
    .click();
  await page
    .getByLabel(/Permanently delete this conversation\./)
    .check();
  await expect(page.getByText(/Existing long-term memory is retained/)).toBeVisible();
  await page
    .getByRole("button", { name: "Delete conversation", exact: true })
    .click();
  await expect(page).toHaveURL(newConversationUrl);

  await page
    .getByRole("button", { name: "Open conversation actions", exact: true })
    .click();
  await page
    .getByLabel(/Permanently delete this conversation\./)
    .check();
  await page
    .getByRole("button", { name: "Delete conversation", exact: true })
    .click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(
    page.locator(`a[href="${new URL(newConversationUrl).pathname}"]`),
  ).toHaveCount(0);
  await assertComposerReplayAndCrashRecovery(page);
});
