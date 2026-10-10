import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "vitest";

const root = join(__dirname, "..", "..");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const dockerfile = readFileSync(join(root, "Dockerfile"), "utf8");

function dependencySpec(name: string): string | undefined {
  return packageJson.dependencies?.[name] ?? packageJson.devDependencies?.[name];
}

test("uses TypeScript 7 compiler with official TypeScript 6 tool API compatibility", async () => {
  expect(dependencySpec("typescript")).toBe("npm:@typescript/typescript6@6.0.3");
  expect(dependencySpec("@typescript/native")).toBe("npm:typescript@7.0.2");

  const typescript = await import("typescript");
  expect(typescript.version).toBe("6.0.3");

  const tscVersion = execFileSync(join(root, "node_modules", ".bin", "tsc"), [
    "--version",
  ], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  expect(tscVersion).toBe("Version 7.0.2");
});

test("keeps package dependency pins exact", () => {
  const allDependencies = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };

  expect(Object.keys(allDependencies).length).toBeGreaterThan(0);

  for (const [name, spec] of Object.entries(allDependencies)) {
    expect(spec, `${name} must use an exact pinned dependency spec`).not.toMatch(/^[~^*]|[<>xX]/);
    expect(spec, `${name} must not be floated with latest`).not.toBe("latest");
  }
});

test("build runs native TypeScript 7 typecheck before next build and Docker uses that entry point", () => {
  expect(packageJson.scripts?.build).toBe("pnpm typecheck && next build");
  expect(packageJson.scripts?.typecheck).toBe("next typegen && tsc --noEmit");
  expect(dockerfile).toContain("RUN pnpm build && rm -rf .next/cache");
});
