import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { unzipSync, strFromU8 } from "fflate";
import { bootstrapAdmin, createAdminTestDatabase } from "./support/admin";
import { e2eEnvironment } from "./support/environment";
import {
  fakeModelRequests,
  registerAndSignIn,
  resetFakeModel,
  startCharacterConversation,
} from "./support/chat";
import { completeChat, memoryUrl, waitForExtraction } from "./support/memory";
import { waitForActionUrl } from "./helpers/mailbox";
import { privacySentinels, scanPrivacySurfaces } from "../release/privacy-scan";

test("private ZIP, expiry, immediate lockout, stalled work purge, and all-surface privacy gate", async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const database = createAdminTestDatabase(e2eEnvironment.DATABASE_URL!);
  const otherContext = await browser.newContext();
  const adminContext = await browser.newContext();
  const retained = await browser.newContext();
  const root = "test-results/privacy-release";
  const evidence: Promise<void>[] = [];
  let responseNumber = 0;
  const email = `privacy-${randomUUID()}@example.com`;
  const otherEmail = `privacy-other-${randomUUID()}@example.com`;
  let userId: string | undefined;
  try {
    await database.$client.query("DELETE FROM rate_limit");
    await resetFakeModel();
    await rm(root, { recursive: true, force: true });
    for (const name of [
      "responses",
      "admin-html",
      "app-logs",
      "worker-logs",
      "static-assets",
    ]) {
      await mkdir(`${root}/${name}`, { recursive: true });
    }
    // Capture before delivery; canceled prefetches and CDP body eviction cannot
    // silently omit completed responses. Redirects are delivered unchanged.
    await page.route("**/*", (route) => {
      if (new URL(route.request().url()).origin !== "http://127.0.0.1:3000")
        return route.continue();
      const number = ++responseNumber;
      const capture = (async () => {
        const response = await route.fetch({ maxRedirects: 0 });
        const body = await response.body();
        await writeFile(
          `${root}/responses/${number}-${response.status()}`,
          Buffer.concat([
            Buffer.from(
              JSON.stringify({
                url: route.request().url(),
                status: response.status(),
                headers: response.headers(),
              }) + "\n",
            ),
            body,
          ]),
        );
        await route.fulfill({ response, body });
      })();
      evidence.push(capture);
      return capture;
    });
    await registerAndSignIn(page, { email });
    userId = (
      await database.$client.query('SELECT id FROM "user" WHERE email=$1', [
        email,
      ])
    ).rows[0].id;
    await retained.addCookies(await page.context().cookies());
    const other = await otherContext.newPage();
    await registerAndSignIn(other, { email: otherEmail });
    await startCharacterConversation(other, "calm-listener");
    await completeChat(other, privacySentinels.otherUser);
    const conversationId = await startCharacterConversation(
      page,
      "calm-listener",
    );
    const memories = await memoryUrl(page);
    await completeChat(
      page,
      `[memory-direct] I prefer ${privacySentinels.privateContent}`,
    );
    await waitForExtraction(database, conversationId);
    await completeChat(page, "[memory-invalid-json] private structured error");
    await waitForExtraction(database, conversationId);
    await page.goto(memories);
    await expect(
      page.getByRole("region", { name: "Saved memories" }),
    ).toContainText(privacySentinels.privateContent);
    await expect(
      page.getByRole("region", { name: "Memory synchronization" }),
    ).toContainText("Needs retry");
    await expect(
      page.getByRole("button", { name: "Retry extraction", exact: true }),
    ).toBeVisible();
    await page.goto(`/app/conversations/${conversationId}`);
    await expect(
      page.locator('li[data-status="complete"]').last(),
    ).toContainText("E2E reply");
    await page.goto("/account");
    await page
      .getByRole("button", { name: "Request data export", exact: true })
      .click();
    await expect(
      page.getByRole("link", { name: "Download ZIP", exact: true }),
    ).toBeVisible({ timeout: 45_000 });
    const href = (await page
      .getByRole("link", { name: "Download ZIP", exact: true })
      .getAttribute("href")) as string;
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download ZIP", exact: true }).click();
    const download = await downloadPromise;
    const archivePath = `${root}/owner-export.zip`;
    await download.saveAs(archivePath);
    const bytes = await readFile(archivePath);
    expect(bytes.subarray(0, 2).toString()).toBe("PK");
    const archive = unzipSync(bytes);
    const json = Object.values(archive)
      .map((value) => strFromU8(value))
      .join("\n");
    await writeFile(`${root}/responses/owner-export-decoded-200`, json);
    expect(json).toContain(email);
    expect(json).toContain(privacySentinels.privateContent);
    expect(json).not.toContain(otherEmail);
    for (const sentinel of [
      privacySentinels.providerKey,
      privacySentinels.providerEndpoint,
      privacySentinels.otherUser,
    ]) {
      expect(json).not.toContain(sentinel);
    }
    const denied = await other.request.get(`http://127.0.0.1:3000${href}`);
    expect(denied.status()).toBe(404);
    await writeFile(`${root}/responses/other-owner-404`, await denied.body());
    const exportId = href.split("/")[3];
    await promisify(execFile)(
      process.execPath,
      [
        "--conditions=react-server",
        "--import",
        "tsx",
        "tests/release/expire-export.ts",
        exportId,
      ],
      { env: e2eEnvironment },
    );
    const expired = await page.request.get(href);
    expect(expired.status()).toBe(404);
    await writeFile(`${root}/responses/expired-404`, await expired.body());
    expect(
      (
        await database.$client.query(
          "SELECT archive_bytes FROM data_export_jobs WHERE id=$1",
          [exportId],
        )
      ).rows[0].archive_bytes,
    ).toBeNull();

    const admin = await adminContext.newPage();
    await database.$client.query("DELETE FROM rate_limit");
    await bootstrapAdmin(
      admin,
      `privacy-admin-${randomUUID()}@example.com`,
      "correct horse battery staple",
      database,
    );
    for (const path of [
      "/admin",
      "/admin/users",
      "/admin/characters",
      "/admin/usage",
      "/admin/audit",
      "/admin/memory",
    ]) {
      const response = await admin.goto(`http://127.0.0.1:3000${path}`);
      expect(response?.status()).toBe(200);
      await writeFile(
        `${root}/admin-html/${path.replaceAll("/", "_")}.html`,
        await admin.content(),
      );
    }
    await page.goto(`/app/conversations/${conversationId}`);
    await page.getByLabel("Message", { exact: true }).fill("[auth-fail]");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.locator('li[data-status="failed"]').last()).toBeVisible();
    await page.goto("/account");
    // A leased running job reproduces a crashed/stalled export without sleeping or altering worker code.
    await database.$client
      .query(`CREATE FUNCTION task12_hold_export() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.user_id = '${userId}' THEN NEW.status := 'running'; NEW.started_at := now(); NEW.attempt_count := 1; END IF;
      RETURN NEW; END $$;
      CREATE TRIGGER task12_hold_export BEFORE INSERT ON data_export_jobs FOR EACH ROW EXECUTE FUNCTION task12_hold_export();`);
    await page
      .getByRole("button", { name: "Request data export", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (
            await database.$client.query(
              "SELECT count(*)::int AS n FROM data_export_jobs WHERE user_id=$1 AND status='running'",
              [userId],
            )
          ).rows[0].n,
      )
      .toBe(1);
    await database.$client.query(
      "DROP TRIGGER task12_hold_export ON data_export_jobs; DROP FUNCTION task12_hold_export()",
    );
    await page.goto(`/app/conversations/${conversationId}`);
    await completeChat(
      page,
      "[memory-stall] I prefer resurrected private data",
    );
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
    const held = (await fakeModelRequests())
      .reverse()
      .find(
        (request) =>
          request.body.stream === false &&
          JSON.stringify(request.body).includes("[memory-stall]"),
      )!;
    await page.goto("/account");
    await page.getByLabel("Confirm account email").fill(email);
    await page
      .getByRole("button", { name: "Delete account", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "confirmation link" }),
    ).toBeVisible();
    const requestId = (
      await database.$client.query(
        "SELECT id FROM account_deletion_requests WHERE user_id=$1",
        [userId],
      )
    ).rows[0].id;
    const privateIds = await database.$client.query(
      `SELECT
      ARRAY(SELECT id FROM memory_extraction_runs WHERE user_id=$1) AS extraction_ids,
      ARRAY(SELECT id FROM relationship_summary_runs WHERE user_id=$1) AS summary_ids,
      ARRAY(SELECT id FROM relationship_summary_versions WHERE user_id=$1) AS summary_version_ids,
      ARRAY(SELECT e.id FROM memory_extraction_executions e JOIN memory_extraction_runs r ON r.id=e.run_id WHERE r.user_id=$1
        UNION ALL SELECT e.id FROM relationship_summary_executions e JOIN relationship_summary_runs r ON r.id=e.run_id WHERE r.user_id=$1) AS operation_ids,
      ARRAY(SELECT id FROM memory_items WHERE user_id=$1) AS memory_ids,
      ARRAY(SELECT id FROM conversations WHERE user_id=$1) AS conversation_ids,
      ARRAY(SELECT id FROM generation_attempts WHERE user_id=$1) AS attempt_ids`,
      [userId],
    );
    await page.goto(await waitForActionUrl(email, "Confirm deletion"));
    await page
      .getByRole("button", { name: "Confirm account deletion", exact: true })
      .click();
    await expect(page).toHaveURL(/\/goodbye$/);
    const deniedSession = await retained.request.get(
      "http://127.0.0.1:3000/api/auth/get-session",
    );
    expect(await deniedSession.json()).toBeNull();
    await writeFile(
      `${root}/responses/locked-session-200`,
      await deniedSession.body(),
    );
    const retainedPage = await retained.newPage();
    await retainedPage.goto("http://127.0.0.1:3000/account");
    await expect(retainedPage).toHaveURL(/\/auth\/sign-in$/);
    const release = await fetch("http://127.0.0.1:3102/__e2e__/control", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ completeRequestId: held.id }),
    });
    expect(release.status).toBe(204);
    await expect
      .poll(
        async () =>
          (
            await database.$client.query(
              "SELECT status FROM account_deletion_requests WHERE id=$1",
              [requestId],
            )
          ).rows[0]?.status,
        { timeout: 45_000 },
      )
      .toBe("complete");
    for (const table of [
      "user",
      "account",
      "session",
      "conversations",
      "generation_attempts",
      "memory_items",
      "memory_extraction_runs",
      "relationship_summaries",
      "relationship_summary_versions",
      "relationship_summary_runs",
      "user_character_memory_settings",
      "data_export_jobs",
      "user_chat_quota_overrides",
      "usage_ledger",
      "quota_buckets",
    ]) {
      const column = table === "user" ? "id" : "user_id";
      expect(
        (
          await database.$client.query(
            `SELECT count(*)::int AS n FROM "${table}" WHERE "${column}"=$1`,
            [userId],
          )
        ).rows[0].n,
        table,
      ).toBe(0);
    }
    for (const [table, column, ids] of [
      [
        "memory_extraction_executions",
        "run_id",
        privateIds.rows[0].extraction_ids,
      ],
      [
        "relationship_summary_executions",
        "run_id",
        privateIds.rows[0].summary_ids,
      ],
      ["memory_evidence", "memory_id", privateIds.rows[0].memory_ids],
      [
        "conversation_messages",
        "conversation_id",
        privateIds.rows[0].conversation_ids,
      ],
      ["quota_reservations", "attempt_id", privateIds.rows[0].attempt_ids],
      ["generation_leases", "attempt_id", privateIds.rows[0].attempt_ids],
      [
        "background_model_reservations",
        "operation_id",
        privateIds.rows[0].operation_ids,
      ],
      [
        "usage_ledger",
        "background_operation_id",
        privateIds.rows[0].operation_ids,
      ],
      [
        "usage_ledger",
        "memory_extraction_run_id",
        privateIds.rows[0].extraction_ids,
      ],
      [
        "usage_ledger",
        "relationship_summary_version_id",
        privateIds.rows[0].summary_version_ids,
      ],
    ] as const) {
      expect(
        (
          await database.$client.query(
            `SELECT count(*)::int AS n FROM "${table}" WHERE "${column}"=ANY($1::text[])`,
            [ids],
          )
        ).rows[0].n,
        table,
      ).toBe(0);
    }
    expect(
      (
        await database.$client.query(
          "SELECT count(*)::int AS n FROM verification WHERE identifier LIKE $1 OR value LIKE $1",
          [`%${email}%`],
        )
      ).rows[0].n,
    ).toBe(0);
    const tombstone = (
      await database.$client.query(
        "SELECT * FROM account_deletion_requests WHERE id=$1",
        [requestId],
      )
    ).rows[0];
    expect(tombstone.user_id).toBeNull();
    expect(tombstone.verification_token_hash).toBeNull();
    expect(JSON.stringify(tombstone)).not.toContain(email);
    await Promise.all(evidence);
    const statuses = await import("node:fs/promises").then((fs) =>
      fs.readdir(`${root}/responses`),
    );
    expect(statuses.some((name) => name.endsWith("-200"))).toBe(true);
    expect(statuses.some((name) => name.includes("404"))).toBe(true);
    await cp("test-results/e2e-app.log", `${root}/app-logs/all.log`);
    await cp("test-results/e2e-worker.log", `${root}/worker-logs/all.log`);
    await cp(".next/static", `${root}/static-assets/next`, { recursive: true });
    await cp("public", `${root}/static-assets/public`, { recursive: true });
    const scan = await scanPrivacySurfaces(root);
    await writeFile(
      `${root}/scan-result.json`,
      JSON.stringify(
        {
          ...scan,
          responses: responseNumber,
          successAndError: true,
        },
        null,
        2,
      ),
    );
  } finally {
    await database.$client.query(
      "DROP TRIGGER IF EXISTS task12_hold_export ON data_export_jobs; DROP FUNCTION IF EXISTS task12_hold_export()",
    );
    await Promise.all([
      otherContext.close(),
      adminContext.close(),
      retained.close(),
      database.$client.end(),
    ]);
  }
});
