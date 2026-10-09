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
  expect(runner).toContain(
    "COPY --from=build /app/pnpm-lock.yaml ./pnpm-lock.yaml",
  );
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
  const entrypoint = await readFile("scripts/docker-entrypoint.sh", "utf8");

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

test("deployment command migrates and seeds official characters and chat settings", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
    scripts: Record<string, string>;
  };
  const composeSource = await readFile("docker-compose.yml", "utf8");
  const compose = parse(composeSource) as {
    "x-application": {
      image?: string;
      volumes?: string[];
    };
    services: {
      migrate: {
        command?: string[];
      };
    };
  };

  expect(packageJson.scripts["db:seed:characters"]).toBe(
    "node --env-file-if-exists=.env --import tsx src/server/db/seed-characters.ts",
  );
  expect(packageJson.scripts["db:seed:chat-settings"]).toBe(
    "node --env-file-if-exists=.env --import tsx src/server/db/seed-chat-settings.ts",
  );
  expect(packageJson.scripts["db:deploy"]).toBe(
    "pnpm db:migrate && pnpm db:seed:characters && pnpm db:seed:chat-settings",
  );
  expect(compose["x-application"].image).toBe("ai-companion-web:phase-3");
  expect(compose["x-application"].volumes).toContain(
    "./public/characters:/app/public/characters:ro",
  );
  expect(compose.services.migrate.command).toEqual(["pnpm", "db:deploy"]);
});

test("production model secrets reach runtime services without becoming build arguments", async () => {
  const dockerfile = await readFile("Dockerfile", "utf8");
  const composeSource = await readFile("docker-compose.yml", "utf8");
  const compose = parse(composeSource) as {
    "x-application": {
      environment?: Record<string, string>;
    };
  };

  expect(compose["x-application"].environment).toMatchObject({
    MODEL_API_BASE_URL:
      "${MODEL_API_BASE_URL:?set MODEL_API_BASE_URL}",
    MODEL_API_KEY: "${MODEL_API_KEY:?set MODEL_API_KEY}",
    MODEL_ID: "${MODEL_ID:?set MODEL_ID}",
  });
  expect(dockerfile).not.toMatch(/^ARG MODEL_/m);
  expect(dockerfile).not.toContain("NEXT_PUBLIC_MODEL_");
  expect(composeSource).not.toContain("NEXT_PUBLIC_MODEL_");
});

test("the deterministic model provider remains Playwright-only", async () => {
  const composeSource = await readFile("compose.test.yml", "utf8");
  const compose = parse(composeSource) as {
    services: Record<string, unknown>;
  };

  expect(Object.keys(compose.services).sort()).toEqual(["mailpit", "postgres"]);
  expect(composeSource).toContain(
    "Playwright owns the loopback-only fake model server",
  );
  expect(composeSource).not.toContain("3102:3102");
  expect(composeSource).not.toContain("__e2e__");
});
