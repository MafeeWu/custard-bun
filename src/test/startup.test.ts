// @vitest-environment node
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { validSecretEnv } from "./unit/runtime-config-fixture";

test("production start uses the socket-bound, validating server", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  expect(manifest.scripts.start).toContain("src/server/start.ts");
});

test("worker launch paths enable server-only model and accounting imports", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  expect(manifest.scripts.worker).toContain("--conditions=react-server");
  expect(
    await readFile("tests/e2e/support/worker-harness.ts", "utf8"),
  ).toContain("--conditions=react-server");
});

test.each(["src/server/start.ts", "src/worker.ts"])(
  "%s exits before listening with specific sanitized config diagnostics",
  async (entry) => {
    const manifest = JSON.parse(await readFile("package.json", "utf8"));
    const command: string =
      entry === "src/worker.ts"
        ? manifest.scripts.worker
        : manifest.scripts.start;
    const result = await new Promise<{
      code: number | string | undefined;
      output: string;
    }>((resolve) => {
      execFile(
        process.execPath,
        command.split(" ").slice(1),
        {
          env: {
            ...process.env,
            ...validSecretEnv,
            BETTER_AUTH_SECRET: "private-token",
            PORT: "3199",
          },
          timeout: 10_000,
          killSignal: "SIGKILL",
        },
        (error, stdout, stderr) =>
          resolve({
            code: error?.code ?? undefined,
            output: stdout + stderr,
          }),
      );
    });
    expect(result.code).toBe(1);
    expect(result.output).toContain("environment.BETTER_AUTH_SECRET");
    expect(result.output).toContain("32");
    expect(result.output).not.toContain("private-token");
    await expect(
      fetch("http://127.0.0.1:3199/api/health/live"),
    ).rejects.toThrow();
  },
);
