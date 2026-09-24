// @vitest-environment node
import { afterEach, expect, test, vi } from "vitest";
import {
  startWorkerHeartbeat,
  type HeartbeatDatabase,
} from "./worker-heartbeat";

afterEach(() => {
  vi.useRealTimers();
});

test("records immediately and refreshes every 20 seconds", async () => {
  const recordHeartbeat = vi.fn().mockResolvedValue(undefined);
  const clearIntervalFn = vi.fn();
  const timer = { unref: vi.fn() };
  let scheduled: (() => void) | undefined;
  const setIntervalFn = vi.fn((callback: () => void, delay: number) => {
    scheduled = callback;
    expect(delay).toBe(20_000);
    return timer as unknown as NodeJS.Timeout;
  });

  const heartbeat = await startWorkerHeartbeat({} as HeartbeatDatabase, {
    recordHeartbeat,
    setIntervalFn,
    clearIntervalFn,
  });

  expect(recordHeartbeat).toHaveBeenCalledWith({}, "auth-email-worker");
  expect(recordHeartbeat).toHaveBeenCalledTimes(1);
  expect(timer.unref).toHaveBeenCalledOnce();

  scheduled?.();
  await vi.waitFor(() => expect(recordHeartbeat).toHaveBeenCalledTimes(2));

  await heartbeat.stop();
  expect(clearIntervalFn).toHaveBeenCalledWith(timer);
});

test("does not overlap heartbeat writes", async () => {
  vi.useFakeTimers();
  let finishRefresh: (() => void) | undefined;
  const recordHeartbeat = vi
    .fn()
    .mockResolvedValueOnce(undefined)
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishRefresh = resolve;
        }),
    )
    .mockResolvedValue(undefined);

  const heartbeat = await startWorkerHeartbeat({} as HeartbeatDatabase, {
    recordHeartbeat,
  });

  await vi.advanceTimersByTimeAsync(20_000);
  expect(recordHeartbeat).toHaveBeenCalledTimes(2);

  await vi.advanceTimersByTimeAsync(40_000);
  expect(recordHeartbeat).toHaveBeenCalledTimes(2);

  finishRefresh?.();
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(20_000);
  expect(recordHeartbeat).toHaveBeenCalledTimes(3);

  await heartbeat.stop();
});

test("stop waits for an in-flight heartbeat write", async () => {
  vi.useFakeTimers();
  let finishRefresh: (() => void) | undefined;
  const recordHeartbeat = vi
    .fn()
    .mockResolvedValueOnce(undefined)
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishRefresh = resolve;
        }),
    );

  const heartbeat = await startWorkerHeartbeat({} as HeartbeatDatabase, {
    recordHeartbeat,
  });
  await vi.advanceTimersByTimeAsync(20_000);

  let stopped = false;
  const stopPromise = heartbeat.stop().then(() => {
    stopped = true;
  });
  await Promise.resolve();
  expect(stopped).toBe(false);

  finishRefresh?.();
  await stopPromise;
  expect(stopped).toBe(true);
});

test("heartbeat logging never includes private error details", async () => {
  const recordHeartbeat = vi
    .fn()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(
      new Error("postgresql://user:secret@db/private refused"),
    );
  const logger = { error: vi.fn() };
  let scheduled: (() => void) | undefined;

  const heartbeat = await startWorkerHeartbeat({} as HeartbeatDatabase, {
    recordHeartbeat,
    logger,
    setIntervalFn(callback) {
      scheduled = callback;
      return { unref: vi.fn() } as unknown as NodeJS.Timeout;
    },
    clearIntervalFn: vi.fn(),
  });

  scheduled?.();
  await vi.waitFor(() => expect(logger.error).toHaveBeenCalledOnce());

  expect(logger.error).toHaveBeenCalledWith("worker heartbeat failed", {
    name: "Error",
  });
  expect(JSON.stringify(logger.error.mock.calls)).not.toContain("secret");
  expect(JSON.stringify(logger.error.mock.calls)).not.toContain("private");
  await heartbeat.stop();
});
