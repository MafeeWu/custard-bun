// @vitest-environment node
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { access, rm } from "node:fs/promises";
import { expect, test, vi } from "vitest";
import { withBrandingServer } from "../../tests/e2e/support/branding-server";
import { e2eEnvironment } from "../../tests/e2e/support/environment";

const configPath = "test-results/owned-branding.yml";
const absent = () => expect(access(configPath)).rejects.toThrow();

test("spawn failure is handled and YAML is always removed", async () => {
  await expect(
    withBrandingServer(configPath, "branding: {}", async () => {}, {
      spawnFn: () => spawn("/does-not-exist-branding", []),
      readinessTimeoutMs: 100,
      shutdownTimeoutMs: 100,
    }),
  ).rejects.toThrow("Unable to spawn branding server");
  await absent();
});

test("synchronous spawn failure also cleans YAML", async () => {
  await expect(
    withBrandingServer(configPath, "branding: {}", async () => {}, {
      spawnFn: () => {
        throw new Error("spawn failed");
      },
    }),
  ).rejects.toThrow("spawn failed");
  await absent();
});

test("shared runtime environment, streams and signal-terminated child are owned", async () => {
  const child = Object.assign(new EventEmitter(), {
    exitCode: null,
    signalCode: "SIGTERM",
    pid: undefined,
    stdout: { resume: vi.fn() },
    stderr: { resume: vi.fn() },
    kill: vi.fn(),
  });
  const spawnFn = vi.fn(() => child as unknown as ReturnType<typeof spawn>);
  await expect(
    withBrandingServer(configPath, "branding: {}", async () => {}, {
      spawnFn,
      readinessTimeoutMs: 50,
      shutdownTimeoutMs: 50,
    }),
  ).rejects.toThrow("branding server exited");
  expect(spawnFn.mock.calls[0]).toEqual([
    process.execPath,
    ["--import", "tsx", "src/server/start.ts"],
    expect.objectContaining({
      env: {
        ...e2eEnvironment,
        PORT: "3100",
        APP_CONFIG_PATH: configPath,
        BETTER_AUTH_URL: "http://127.0.0.1:3100",
      },
    }),
  ]);
  expect(child.stdout.resume).toHaveBeenCalled();
  expect(child.stderr.resume).toHaveBeenCalled();
  expect(child.kill).not.toHaveBeenCalled();
  expect(child.listenerCount("error")).toBe(0);
  expect(child.listenerCount("exit")).toBe(0);
  await absent();
});

test("timeout terminates the exact child with bounded TERM then KILL and cleans YAML", async () => {
  let child: ReturnType<typeof spawn> | undefined;
  try {
    await expect(
      withBrandingServer(configPath, "branding: {}", async () => {}, {
        spawnFn: () => {
          child = spawn(
            process.execPath,
            ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],
            { stdio: "pipe" },
          );
          return child;
        },
        ready: async () => false,
        readinessTimeoutMs: 300,
        shutdownTimeoutMs: 100,
      }),
    ).rejects.toThrow("Timed out waiting");
    expect(child?.signalCode).toBe("SIGKILL");
    expect(() => process.kill(child!.pid!, 0)).toThrow();
    await absent();
  } finally {
    if (child && child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    await rm(configPath, { force: true });
  }
});

test("successful use and assertion failures both guarantee child and YAML cleanup", async () => {
  let child: ReturnType<typeof spawn> | undefined;
  await expect(
    withBrandingServer(
      configPath,
      "branding: {}",
      async () => {
        throw new Error("assertion failed");
      },
      {
        spawnFn: () => {
          child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
            stdio: "pipe",
          });
          return child;
        },
        ready: async () => true,
        shutdownTimeoutMs: 200,
      },
    ),
  ).rejects.toThrow("assertion failed");
  expect(child?.exitCode !== null || child?.signalCode !== null).toBe(true);
  await absent();
});
