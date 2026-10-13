import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { Pool } from "pg";
import {
  fixturePath,
  migrationHashes,
  verifyPhase3Upgrade,
} from "./database-gate";
import { filesRecursively, privacySentinels } from "./privacy-scan";
import { assertVisualEvidenceFilesArePrivate } from "./visual-evidence";

const root = ".superpowers/release-compose";
const project = `task12-release-${process.pid}`;
const image = `ai-companion-web:${project}`;
const initialImages = new Set<string>();
const buildImages = new Set<string>();
let failedBuildContainer: string | undefined;
let buildOutput = "";
const env = {
  ...process.env,
  POSTGRES_PASSWORD: "release-test-password",
  MODEL_API_KEY: privacySentinels.providerKey,
  MODEL_API_BASE_URL: `http://fake-model:3102/${privacySentinels.providerEndpoint}/v1`,
  MODEL_ID: "e2e-chat-model",
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: "1025",
  SMTP_SECURE: "false",
  SMTP_USER: "test",
  SMTP_PASSWORD: "test",
  SMTP_FROM: "Release Gate <noreply@example.com>",
  APP_PORT: "3300",
  RELEASE_IMAGE: image,
};

function compose(args: string[], capture = false) {
  const result = spawnSync(
    "docker",
    [
      "compose",
      "-p",
      project,
      "-f",
      "docker-compose.yml",
      "-f",
      "tests/release/compose.release.yml",
      ...args,
    ],
    {
      env,
      stdio: capture ? "pipe" : "inherit",
      maxBuffer: 20 * 1024 * 1024,
    },
  );
  if (args[0] === "build") {
    buildOutput = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    console.log(buildOutput);
    for (const match of buildOutput.matchAll(/---> ([a-f0-9]{12})\b/g)) {
      if (!initialImages.has(match[1])) buildImages.add(match[1]);
    }
    if (result.status !== 0) {
      failedBuildContainer = [
        ...buildOutput.matchAll(/Running in ([a-f0-9]{12})\b/g),
      ].at(-1)?.[1];
    }
  }
  assert.equal(result.status, 0, `Compose failed: ${args.join(" ")}`);
  return result.stdout?.toString() ?? "";
}

async function until(check: () => Promise<boolean>) {
  const deadline = Date.now() + 60_000;
  while (!(await check())) {
    if (Date.now() > deadline)
      throw new Error("Production processing did not complete");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

function job(operation: string, databaseUrl: string) {
  const result = spawnSync(
    process.execPath,
    [
      "--conditions=react-server",
      "--import",
      "tsx",
      "tests/release/production-jobs.ts",
      operation,
    ],
    {
      env: {
        ...env,
        DATABASE_URL: databaseUrl,
        TEST_DATABASE_URL: databaseUrl,
        BETTER_AUTH_SECRET: "release-test-secret-at-least-32-characters",
        BETTER_AUTH_URL: "http://localhost:3300",
      },
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim().split("\n").at(-1)!);
}

async function main() {
  await mkdir(root, { recursive: true });
  const databaseUrl =
    "postgresql://companion:release-test-password@127.0.0.1:55542/companion_test";
  let pool: Pool | undefined;
  try {
    const existing = spawnSync(
      "docker",
      ["image", "ls", "--format", "{{.ID}}"],
      {
        encoding: "utf8",
      },
    );
    assert.equal(existing.status, 0);
    existing.stdout
      .trim()
      .split(/\s+/)
      .forEach((id) => initialImages.add(id));
    compose(["build", "app"], true);
    compose(["up", "-d", "--wait", "postgres", "fake-model"]);
    pool = new Pool({ connectionString: databaseUrl });
    await pool.query(await readFile(fixturePath, "utf8"));
    await pool.query("SET search_path TO public");
    compose(["up", "-d", "--wait", "app", "worker"]);
    await verifyPhase3Upgrade(pool);
    const migrations = await migrationHashes(pool);
    const ready = await fetch("http://localhost:3300/api/health/ready");
    assert.equal(ready.status, 200);
    assert.equal((await ready.json()).ready, true);
    compose([
      "exec",
      "-T",
      "worker",
      "/bin/sh",
      "/app/scripts/docker-entrypoint.sh",
      "pnpm",
      "health:worker",
    ]);
    const queues = (
      await pool.query("SELECT name FROM job.queue ORDER BY name")
    ).rows.map((row) => row.name);
    for (const queue of [
      "memory-extraction",
      "relationship-summary",
      "data-export",
      "data-export-expiry",
      "account-purge",
    ])
      assert(queues.includes(queue));
    const requests = JSON.parse(
      compose(
        [
          "exec",
          "-T",
          "fake-model",
          "node",
          "-e",
          "fetch('http://127.0.0.1:3102/__e2e__/requests').then(r=>r.text()).then(console.log)",
        ],
        true,
      ),
    );
    assert.equal(
      requests.length,
      0,
      "Readiness or upgrade called the provider",
    );
    const signIn = await fetch("http://localhost:3300/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3300",
      },
      body: JSON.stringify({
        email: "phase3-fixture@example.com",
        password: "phase3 fixture password for release gate",
      }),
    });
    assert.equal(signIn.status, 200);
    const cookie = signIn.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const transcript = await fetch(
      "http://localhost:3300/app/conversations/30000000-0000-4000-8000-000000000003",
      { headers: { cookie } },
    );
    assert.equal(transcript.status, 200);
    assert(
      (await transcript.text()).includes(
        "Phase 3 fixture: jasmine tea before memory rollout",
      ),
    );
    const generation = await fetch(
      "http://localhost:3300/api/chat/conversations/30000000-0000-4000-8000-000000000003/messages",
      {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/json",
          origin: "http://localhost:3300",
        },
        body: JSON.stringify({
          clientRequestId: randomUUID(),
          content: "[memory-direct] I prefer production jasmine tea",
        }),
      },
    );
    assert.equal(generation.status, 200);
    assert((await generation.text()).includes('"type":"completed"'));
    await until(
      async () =>
        (
          await pool!.query(
            "SELECT count(*)::int AS n FROM memory_items WHERE user_id='phase3-user' AND content LIKE '%production jasmine tea%'",
          )
        ).rows[0].n === 1,
    );
    await until(
      async () =>
        (
          await pool!.query(
            "SELECT count(*)::int AS n FROM relationship_summary_versions WHERE user_id='phase3-user'",
          )
        ).rows[0].n > 0,
    );
    const { exportId } = job("export", databaseUrl);
    await until(
      async () =>
        (
          await pool!.query("SELECT status FROM data_export_jobs WHERE id=$1", [
            exportId,
          ])
        ).rows[0]?.status === "complete",
    );
    const exported = await fetch(
      `http://localhost:3300/account/exports/${exportId}/download`,
      { headers: { cookie } },
    );
    assert.equal(exported.status, 200);
    assert.equal(
      Buffer.from(await exported.arrayBuffer())
        .subarray(0, 2)
        .toString(),
      "PK",
    );
    const { requestId } = job("purge", databaseUrl);
    const locked = await fetch("http://localhost:3300/api/auth/get-session", {
      headers: { cookie },
    });
    assert.equal(await locked.json(), null);
    await until(
      async () =>
        (
          await pool!.query(
            "SELECT status FROM account_deletion_requests WHERE id=$1",
            [requestId],
          )
        ).rows[0]?.status === "complete",
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM \"user\" WHERE id='phase3-user'",
        )
      ).rows[0].n,
      0,
    );
    await writeFile(
      `${root}/gate-result.json`,
      JSON.stringify(
        {
          migrations,
          fixtureUpgrade: true,
          appReady: true,
          workerReady: true,
          registeredQueues: queues,
          readinessProviderCalls: 0,
          memoryProcessed: true,
          summaryProcessed: true,
          exportProcessed: true,
          purgeProcessed: true,
        },
        null,
        2,
      ),
    );
    const visualSnapshotSource = "tests/e2e/visual-redesign.spec.ts-snapshots";
    const visualSnapshotEvidence = "test-results/privacy-release/ui-snapshots";
    await assertVisualEvidenceFilesArePrivate(
      await filesRecursively(visualSnapshotSource),
      "ui-snapshots",
    );
    await rm(visualSnapshotEvidence, { recursive: true, force: true });
    await mkdir("test-results/privacy-release", { recursive: true });
    await cp(visualSnapshotSource, visualSnapshotEvidence, {
      recursive: true,
    });
    console.log(await readFile(`${root}/gate-result.json`, "utf8"));
  } finally {
    await pool?.end();
    try {
      await mkdir(root, { recursive: true });
      await writeFile(`${root}/build.log`, buildOutput);
      await writeFile(
        `${root}/app.log`,
        compose(["logs", "--no-color", "app"], true),
      );
      await writeFile(
        `${root}/worker.log`,
        compose(["logs", "--no-color", "worker"], true),
      );
    } finally {
      compose(["down", "-v", "--remove-orphans"]);
      if (failedBuildContainer)
        spawnSync("docker", ["rm", failedBuildContainer], { stdio: "pipe" });
      spawnSync("docker", ["image", "rm", image], { stdio: "inherit" });
      for (const id of [...buildImages].reverse())
        spawnSync("docker", ["image", "rm", id], { stdio: "pipe" });
    }
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
