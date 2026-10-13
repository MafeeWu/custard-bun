// @vitest-environment node
import { readdir, readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { parse } from "yaml";
import { ESLint } from "eslint";

test("lint excludes generated privacy evidence but still covers product and release-gate source", async () => {
  const eslint = new ESLint();
  expect(
    await eslint.isPathIgnored(
      "test-results/privacy-release/static-assets/next/nested.js",
    ),
  ).toBe(true);
  expect(await eslint.isPathIgnored("src/server/worker/lifecycle.ts")).toBe(
    false,
  );
  expect(await eslint.isPathIgnored("tests/release/privacy-scan.ts")).toBe(
    false,
  );
});

test("production build removes rebuild-only cache before creating the image layer", async () => {
  const dockerfile = await readFile("Dockerfile", "utf8");
  expect(dockerfile).toContain(
    "RUN pnpm build --webpack && rm -rf .next/cache",
  );
});

test("production image builds with bounded worker and heap use without changing runtime limits", async () => {
  const dockerfile = await readFile("Dockerfile", "utf8");
  const build = dockerfile
    .split("FROM deps AS build")[1]
    ?.split("FROM base AS runner")[0];
  expect(build).toContain("ENV NODE_OPTIONS=--max-old-space-size=1024");
  expect(build).toContain("pnpm build --webpack");
  expect(dockerfile.split("FROM base AS runner")[1]).not.toContain(
    "NODE_OPTIONS",
  );
  const { default: config } = await import("../../next.config");
  expect(config.experimental?.cpus).toBe(1);
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

test("deployment command migrates and seeds official characters, chat settings, and memory settings", async () => {
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
  expect(packageJson.scripts["db:seed:memory-settings"]).toBe(
    "node --env-file-if-exists=.env --import tsx src/server/db/seed-memory-settings.ts",
  );
  expect(packageJson.scripts["db:deploy"]).toBe(
    "pnpm db:migrate && pnpm db:seed:characters && pnpm db:seed:chat-settings && pnpm db:seed:memory-settings",
  );
  expect(compose["x-application"].image).toBe("ai-companion-web:phase-4");
  expect(compose["x-application"].volumes).toContain(
    "./public/characters:/app/public/characters:ro",
  );
  expect(compose.services.migrate.command).toEqual(["pnpm", "db:deploy"]);
});

test("all runtime jobs mount memory configuration without public build arguments", async () => {
  const source = await readFile("docker-compose.yml", "utf8");
  const compose = parse(source, { merge: true });
  for (const name of ["app", "worker", "migrate"]) {
    expect(compose.services[name].environment).toHaveProperty(
      "APP_CONFIG_PATH",
      "/app/app.config.yml",
    );
    expect(compose.services[name].volumes).toContain(
      "./app.config.yml:/app/app.config.yml:ro",
    );
  }
  expect(source).not.toContain("NEXT_PUBLIC_MEMORY");
  const dockerfile = await readFile("Dockerfile", "utf8");
  expect(dockerfile).not.toMatch(/^ARG (MEMORY|MODEL)_/m);
  expect(dockerfile).toContain("ENV BETTER_AUTH_URL=http://localhost:3000");
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
    MODEL_API_BASE_URL: "${MODEL_API_BASE_URL:?set MODEL_API_BASE_URL}",
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

test("production builds pin repository-owned font, motion, and icon packages without remote assets", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
    dependencies: Record<string, string>;
  };
  const lockfile = await readFile("pnpm-lock.yaml", "utf8");
  const layout = await readFile("src/app/layout.tsx", "utf8");
  const styles = [
    await readFile("src/app/globals.css", "utf8"),
    await readFile("src/app/theme.css", "utf8"),
  ].join("\n");

  expect(packageJson.dependencies).toMatchObject({
    "@phosphor-icons/react": "2.1.10",
    geist: "1.7.2",
    motion: "14.1.0",
  });
  expect(lockfile).toContain("'@phosphor-icons/react@2.1.10'");
  expect(lockfile).toContain("geist@1.7.2");
  expect(lockfile).toContain("motion@14.1.0");
  expect(layout).toContain('from "geist/font/');
  expect(styles).not.toMatch(/url\(\s*["']?https?:\/\//i);
});

test("production image retains every repository-owned public asset", async () => {
  const dockerfile = await readFile("Dockerfile", "utf8");
  const dockerignore = await readFile(".dockerignore", "utf8");
  const brandAssets = await readdir("public/brand");
  const characterAssets = await readdir("public/characters");

  expect(dockerfile).toContain("COPY --from=build /app/public ./public");
  expect(dockerignore).not.toMatch(/^public(?:\/|$)/m);
  expect(brandAssets.sort()).toEqual(["favicon.svg", "logo.svg"]);
  expect(characterAssets.sort()).toEqual([
    "action-coach.svg",
    "calm-listener.svg",
    "creative-storyteller.svg",
    "energetic-friend.svg",
    "rational-companion.svg",
  ]);
});
