// @vitest-environment node
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { expect, test } from "vitest";
import { parse } from "yaml";
import {
  buildProductionJobEnvironment,
  buildReleaseEnvironment,
} from "../../tests/release/environment";
import { privacySentinels } from "../../tests/release/privacy-scan";

test("ships a restorable Phase 3 schema and completed chat fixture, not a Phase 4 empty schema", async () => {
  const fixture = await readFile("tests/release/fixtures/phase3.sql", "utf8");
  expect(fixture).toContain("CREATE TABLE public.generation_attempts");
  expect(fixture).toContain("phase3-user-message");
  expect(fixture).toContain("phase3-attempt");
  expect(fixture).toContain("phase3-usage");
  expect(fixture).toContain("30000000-0000-4000-8000-000000000003");
  expect(fixture).not.toContain("CREATE TABLE public.memory_items");
  expect(fixture).not.toContain("extraction_memory_epoch");
});

test("production gate extends real Compose and starts both app and worker behind migration", async () => {
  const compose = parse(
    await readFile("tests/release/compose.release.yml", "utf8"),
    {
      customTags: [
        {
          tag: "!reset",
          collection: "seq",
          resolve: (value: unknown) => value,
        },
        {
          tag: "!override",
          collection: "seq",
          resolve: (value: unknown) => value,
        },
      ],
    },
  );
  expect(compose.services.app.environment.BETTER_AUTH_URL).toBe(
    "http://localhost:3300",
  );
  expect(compose.services.postgres.ports).toEqual(["127.0.0.1:55542:5432"]);
  expect(compose.services["fake-model"].ports).toBeUndefined();
  const script = await readFile("tests/release/compose-gate.ts", "utf8");
  expect(script).toContain("docker-compose.yml");
  expect(script).toContain("verifyPhase3Upgrade");
  expect(script).toContain("health:worker");
  expect(script).toContain("/app/scripts/docker-entrypoint.sh");
  expect(script).toContain("initialImages");
  expect(script).toContain("buildImages");
  expect(script).toContain("data_export_jobs");
  expect(script).toContain("account_deletion_requests");
  expect(script).toContain("tests/e2e/visual-redesign.spec.ts-snapshots");
  expect(script).toContain("test-results/privacy-release/ui-snapshots");
  expect(script).toContain("assertVisualEvidenceFilesArePrivate");
  expect(script.indexOf("assertVisualEvidenceFilesArePrivate")).toBeLessThan(
    script.indexOf("await cp(visualSnapshotSource"),
  );
});

const fixedReleaseEnvironment = {
  NODE_ENV: "test",
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
  RELEASE_IMAGE: "ai-companion-web:contract-test",
};

test("builds complete fixed release configuration without ambient runtime configuration", () => {
  expect(
    buildReleaseEnvironment("ai-companion-web:contract-test", {
      NODE_ENV: "test",
    }),
  ).toEqual(fixedReleaseEnvironment);
});

test("synthetic release values override ambient values while preserving host tools", () => {
  const ambient = {
    ...Object.fromEntries(
      Object.keys(fixedReleaseEnvironment).map((key) => [
        key,
        "ambient-must-not-win",
      ]),
    ),
    NODE_ENV: "test" as const,
    PATH: "/host/toolchain",
  };
  const original = { ...ambient };

  expect(
    buildReleaseEnvironment("ai-companion-web:contract-test", ambient),
  ).toEqual({ ...fixedReleaseEnvironment, PATH: "/host/toolchain" });
  expect(ambient).toEqual(original);
});

test("host production job child receives fixed SMTP and explicit database/auth overrides", () => {
  const releaseEnvironment = buildReleaseEnvironment(
    "ai-companion-web:contract-test",
    {
      NODE_ENV: "test",
      SMTP_HOST: "ambient.invalid",
      SMTP_PORT: "9999",
      SMTP_SECURE: "true",
      SMTP_USER: "ambient-user",
      SMTP_PASSWORD: "ambient-password",
      SMTP_FROM: "ambient@example.invalid",
      DATABASE_URL: "postgresql://ambient.invalid/production",
      TEST_DATABASE_URL: "postgresql://ambient.invalid/production_test",
      BETTER_AUTH_SECRET: "ambient-secret",
      BETTER_AUTH_URL: "https://ambient.invalid",
    },
  );
  const original = { ...releaseEnvironment };
  const env = buildProductionJobEnvironment(
    "postgresql://127.0.0.1:55542/companion_test",
    releaseEnvironment,
  );
  const child = spawnSync(
    process.execPath,
    ["-e", "process.stdout.write(JSON.stringify(process.env))"],
    { env, encoding: "utf8" },
  );

  const expected = {
    ...fixedReleaseEnvironment,
    DATABASE_URL: "postgresql://127.0.0.1:55542/companion_test",
    TEST_DATABASE_URL: "postgresql://127.0.0.1:55542/companion_test",
    BETTER_AUTH_SECRET: "release-test-secret-at-least-32-characters",
    BETTER_AUTH_URL: "http://localhost:3300",
  };
  expect(env).toEqual(expected);
  expect(child.status, child.stderr).toBe(0);
  expect(JSON.parse(child.stdout)).toMatchObject(expected);
  expect(releaseEnvironment).toEqual(original);
});
