// @vitest-environment node
import { expect, test, vi } from "vitest";
import {
  startWorkerHeartbeat,
  type HeartbeatDatabase,
} from "./worker-heartbeat";

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

  const stop = await startWorkerHeartbeat({} as HeartbeatDatabase, {
    recordHeartbeat,
    setIntervalFn,
    clearIntervalFn,
  });

  expect(recordHeartbeat).toHaveBeenCalledWith({}, "auth-email-worker");
  expect(recordHeartbeat).toHaveBeenCalledTimes(1);
  expect(timer.unref).toHaveBeenCalledOnce();

  scheduled?.();
  await vi.waitFor(() => expect(recordHeartbeat).toHaveBeenCalledTimes(2));

  stop();
  expect(clearIntervalFn).toHaveBeenCalledWith(timer);
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

  await startWorkerHeartbeat({} as HeartbeatDatabase, {
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
});
