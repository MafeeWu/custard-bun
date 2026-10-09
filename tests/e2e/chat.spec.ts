import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  fakeModelRequests,
  registerAndSignIn,
  resetFakeModel,
  sendChatMessage,
  startCharacterConversation,
} from "./support/chat";

test("streams, interrupts, retries, stops, restores and deletes conversations safely", async ({
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
    .getByRole("button", { name: "Conversation actions", exact: true })
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
  await page.getByText("Permanently delete this conversation.").click();
  await page
    .getByRole("button", { name: "Delete conversation", exact: true })
    .click();
  await expect(page).toHaveURL(newConversationUrl);

  await page
    .getByRole("button", { name: "Conversation actions", exact: true })
    .click();
  await page.getByText("Permanently delete this conversation.").click();
  await page
    .getByRole("button", { name: "Delete conversation", exact: true })
    .click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(
    page.locator(`a[href="${new URL(newConversationUrl).pathname}"]`),
  ).toHaveCount(0);
});
