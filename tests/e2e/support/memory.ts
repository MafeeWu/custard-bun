import { expect, type Page } from "@playwright/test";
import type { Database } from "../../../src/server/db/client";
import { fakeModelBaseUrl, fakeModelRequests, sendChatMessage } from "./chat";

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
  execution?: {
    runId: string;
    executionId: string;
    jobId: string;
    timeoutMs?: number;
  },
) {
  await expect
    .poll(
      async () => {
        if (execution) {
          const result = await database.$client.query(
            `SELECT r.status, e.response_at, e.settled_at, j.state AS job_state
             FROM memory_extraction_runs r
             JOIN memory_extraction_executions e ON e.run_id=r.id AND e.id=$2
             JOIN job.job j ON j.id=$3::uuid AND j.name='memory-extraction'
             WHERE r.id=$1`,
            [execution.runId, execution.executionId, execution.jobId],
          );
          const row = result.rows[0];
          return row?.response_at &&
            row?.settled_at &&
            ["completed", "cancelled", "failed"].includes(row.job_state)
            ? row.status
            : "outstanding";
        }
        const result = await database.$client.query(
          "SELECT status FROM memory_extraction_runs WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 1",
          [conversationId],
        );
        return result.rows[0]?.status;
      },
      { timeout: execution?.timeoutMs ?? 20_000 },
    )
    .toMatch(/complete|failed|dead_letter|cancelled/);
}

export async function heldExtraction(
  database: Database,
  conversationId: string,
) {
  await expect
    .poll(
      async () =>
        (await fakeModelRequests()).some(
          (request) =>
            request.body.stream === false &&
            JSON.stringify(request.body).includes("[memory-stall]"),
        ),
      { timeout: 15_000 },
    )
    .toBe(true);
  const request = (await fakeModelRequests())
    .reverse()
    .find(
      (request) =>
        request.body.stream === false &&
        JSON.stringify(request.body).includes("[memory-stall]"),
    )!;
  const content = request.body.messages!.at(-1)!.content;
  expect(typeof content).toBe("string");
  const sourceId = JSON.parse(content as string).sourceMessageId;
  let rows: Array<{
    run_id: string;
    user_id: string;
    character_id: string;
    memory_epoch: number;
    job_id: string;
    execution_id: string;
    response_at: Date | null;
    settled_at: Date | null;
  }> = [];
  await expect
    .poll(async () => {
      const result = await database.$client.query(
        `SELECT r.id AS run_id, r.user_id, r.character_id, r.memory_epoch, r.job_id,
                e.id AS execution_id, e.response_at, e.settled_at
         FROM memory_extraction_runs r
         JOIN generation_attempts a ON a.id=r.generation_attempt_id
         JOIN conversation_messages m ON m.id=a.assistant_message_id
         JOIN memory_extraction_executions e ON e.run_id=r.id
         WHERE r.conversation_id=$1 AND m.in_reply_to=$2 AND r.status='running'`,
        [conversationId, sourceId],
      );
      rows = result.rows;
      return rows.length;
    })
    .toBe(1);
  const row = rows[0]!;
  expect(row.response_at).toBeNull();
  expect(row.settled_at).toBeNull();
  expect(row.job_id).toBeTruthy();
  return {
    requestId: request.id,
    runId: row.run_id as string,
    executionId: row.execution_id as string,
    jobId: row.job_id as string,
    userId: row.user_id as string,
    characterId: row.character_id as string,
    memoryEpoch: row.memory_epoch as number,
  };
}

export async function releaseExtraction(
  database: Database,
  conversationId: string,
  held: Awaited<ReturnType<typeof heldExtraction>>,
  forbiddenContent: string,
) {
  const response = await fetch(`${fakeModelBaseUrl}/__e2e__/control`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ completeRequestId: held.requestId }),
  });
  expect(response.status).toBe(204);
  await waitForExtraction(database, conversationId, held);
  const run = await database.$client.query(
    "SELECT status, claim_token, lease_expires_at FROM memory_extraction_runs WHERE id=$1",
    [held.runId],
  );
  expect(run.rows[0]).toMatchObject({
    status: "cancelled",
    claim_token: null,
    lease_expires_at: null,
  });
  const memories = await database.$client.query(
    `SELECT count(*)::int AS n FROM memory_items m
     JOIN user_character_memory_settings s ON s.user_id=m.user_id AND s.character_id=m.character_id
     WHERE m.user_id=$1 AND m.character_id=$2 AND m.memory_epoch=s.memory_epoch AND m.content LIKE $3`,
    [held.userId, held.characterId, `%${forbiddenContent}%`],
  );
  expect(memories.rows[0].n).toBe(0);
  expect(
    (
      await database.$client.query(
        "SELECT count(*)::int AS n FROM memory_items WHERE user_id=$1 AND character_id=$2 AND content LIKE $3",
        [held.userId, held.characterId, `%${forbiddenContent}%`],
      )
    ).rows[0].n,
  ).toBe(0);
}

export async function memoryUrl(page: Page) {
  return (await page
    .getByRole("link", { name: "Manage memory", exact: true })
    .getAttribute("href")) as string;
}

export async function restartConversation(page: Page) {
  const old = page.url();
  await page
    .getByRole("button", { name: "Open conversation actions", exact: true })
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
    .getByRole("button", { name: "Open conversation actions", exact: true })
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
