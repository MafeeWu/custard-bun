// @vitest-environment node
import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { parse } from "yaml";

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

test("production job commands receive complete SMTP runtime configuration without ambient environment", async () => {
  const script = await readFile("tests/release/compose-gate.ts", "utf8");

  for (const entry of [
    'SMTP_HOST: "127.0.0.1"',
    'SMTP_PORT: "1025"',
    'SMTP_SECURE: "false"',
    'SMTP_USER: "test"',
    'SMTP_PASSWORD: "test"',
    'SMTP_FROM: "Release Gate <noreply@example.com>"',
  ])
    expect(script).toContain(entry);
});
