import { expect, type Page } from "@playwright/test";
import type { Database } from "../../../src/server/db/client";
import { fakeModelRequests, sendChatMessage } from "./chat";

export async function completeChat(page: Page, content: string) {
  await sendChatMessage(page, content);
  await expect(page.getByLabel("Message", { exact: true })).toBeEnabled();
  await expect(page.locator('li[data-status="complete"]').last()).toContainText(
    "E2E reply",
  );
}

export async function waitForExtraction(
  database: Database,
  conversationId: string,
) {
  await expect
    .poll(
      async () => {
        const result = await database.$client.query(
          "SELECT status FROM memory_extraction_runs WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 1",
          [conversationId],
        );
        return result.rows[0]?.status;
      },
      { timeout: 20_000 },
    )
    .toMatch(/complete|failed|dead_letter|cancelled/);
}

export async function memoryUrl(page: Page) {
  return (await page
    .getByRole("link", { name: "Manage memory", exact: true })
    .getAttribute("href")) as string;
}

export async function restartConversation(page: Page) {
  const old = page.url();
  await page
    .getByRole("button", { name: "Conversation actions", exact: true })
    .click();
  await page.getByLabel("Archive this conversation and start over.").check();
  await page.getByRole("button", { name: "Start over", exact: true }).click();
  await page.waitForURL((url) => url.href !== old);
  return new URL(page.url()).pathname.split("/").at(-1)!;
}

export async function chatPrompt(currentMessage: string) {
  const requests = await fakeModelRequests();
  const request = requests
    .reverse()
    .find(
      (request) =>
        request.body.stream !== false &&
        request.body.messages?.at(-1)?.content === currentMessage,
    );
  expect(request).toBeDefined();
  return JSON.stringify(request!.body.messages);
}

export async function deleteConversation(page: Page) {
  await page
    .getByRole("button", { name: "Conversation actions", exact: true })
    .click();
  await expect(
    page.getByText(/Existing long-term memory is retained/),
  ).toBeVisible();
  await page.getByLabel(/Permanently delete this conversation/).check();
  await page
    .getByRole("button", { name: "Delete conversation", exact: true })
    .click();
  await expect(page).toHaveURL(/\/app(?:\/conversations\/[0-9a-f-]+)?$/);
}
