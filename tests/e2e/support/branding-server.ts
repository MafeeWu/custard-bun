import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { e2eEnvironment } from "./environment";

interface Options {
  spawnFn?: (
    command: string,
    args: string[],
    options: Parameters<typeof spawn>[2],
  ) => ChildProcess;
  ready?: (url: string) => Promise<boolean>;
  readinessTimeoutMs?: number;
  shutdownTimeoutMs?: number;
}

export async function withBrandingServer(
  configPath: string,
  source: string,
  run: (url: string) => Promise<void>,
  options: Options = {},
): Promise<void> {
  const url = "http://127.0.0.1:3100";
  let child: ChildProcess | undefined;
  let spawnFailed = false;
  let exitObserved = false;
  let resolveExit: () => void = () => {};
  const exited = new Promise<void>((resolve) => {
    resolveExit = resolve;
  });
  const onExit = () => {
    exitObserved = true;
    resolveExit();
  };
  const onError = () => {
    spawnFailed = true;
    if (!child?.pid) onExit();
  };
  const stopped = () =>
    !child ||
    exitObserved ||
    child.exitCode !== null ||
    child.signalCode !== null;
  const waitForExit = async () => {
    if (stopped()) return true;
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        exited.then(() => true),
        new Promise<false>((resolve) => {
          timer = setTimeout(
            () => resolve(false),
            options.shutdownTimeoutMs ?? 5_000,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  const ready = options.ready ?? isReachable;
  try {
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(configPath, source);
    child = (options.spawnFn ?? spawn)(
      process.execPath,
      ["--import", "tsx", "src/server/start.ts"],
      {
        cwd: process.cwd(),
        env: {
          ...e2eEnvironment,
          APP_CONFIG_PATH: configPath,
          PORT: "3100",
          BETTER_AUTH_URL: url,
        },
        stdio: "pipe",
      },
    );
    child.on("error", onError);
    child.on("exit", onExit);
    child.stdout?.resume();
    child.stderr?.resume();
    const deadline = Date.now() + (options.readinessTimeoutMs ?? 30_000);
    for (;;) {
      // Let spawn/error events settle before accepting readiness from the child.
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (spawnFailed) throw new Error("Unable to spawn branding server");
      if (stopped()) throw new Error("branding server exited before readiness");
      if (await ready(url)) break;
      if (Date.now() >= deadline)
        throw new Error("Timed out waiting for runtime branding server");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await run(url);
  } finally {
    try {
      if (child && !stopped()) {
        child.kill("SIGTERM");
        if (!(await waitForExit())) {
          child.kill("SIGKILL");
          if (!(await waitForExit()))
            throw new Error("branding child did not terminate");
        }
      }
    } finally {
      child?.off("error", onError);
      child?.off("exit", onExit);
      await rm(configPath, { force: true });
    }
  }
}

export async function isReachable(url: string): Promise<boolean> {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(500) })).ok;
  } catch {
    return false;
  }
}
