// @vitest-environment node
import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { parse } from "yaml";

test("production build removes rebuild-only cache before creating the image layer", async () => {
  const dockerfile = await readFile("Dockerfile", "utf8");
  expect(dockerfile).toContain("RUN pnpm build && rm -rf .next/cache");
});

test("runtime retains the lockfile so pnpm never resolves and installs a different dependency graph", async () => {
  const dockerfile = await readFile("Dockerfile", "utf8");
  const runner = dockerfile.split("FROM base AS runner")[1];
  expect(runner).toContain("COPY --from=build /app/pnpm-lock.yaml ./pnpm-lock.yaml");
});

test("production services construct DATABASE_URL at runtime from the raw password", async () => {
  const composeSource = await readFile("docker-compose.yml", "utf8");
  const compose = parse(composeSource) as {
    "x-application": {
      entrypoint?: string[];
      environment?: Record<string, string>;
    };
    services: {
      app: {
        command?: string[];
      };
    };
  };
  const entrypoint = await readFile(
    "scripts/docker-entrypoint.sh",
    "utf8",
  );

  expect(compose["x-application"].entrypoint).toEqual([
    "/bin/sh",
    "/app/scripts/docker-entrypoint.sh",
  ]);
  expect(compose["x-application"].environment).not.toHaveProperty(
    "DATABASE_URL",
  );
  expect(compose.services.app.command).toEqual(["pnpm", "start"]);
  expect(entrypoint).toContain("container-database-url.ts");
  expect(entrypoint).toContain('exec "$@"');
});
