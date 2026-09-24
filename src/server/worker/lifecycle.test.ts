// @vitest-environment node
import { expect, test, vi } from "vitest";
import { closeWorkerResources } from "./lifecycle";

test("stops heartbeat and closes pg-boss and database resources", async () => {
  const stopHeartbeat = vi.fn();
  const boss = {
    stop: vi.fn().mockResolvedValue(undefined),
  };
  const database = {
    $client: {
      end: vi.fn().mockResolvedValue(undefined),
    },
  };

  await closeWorkerResources({
    stopHeartbeat,
    boss,
    database,
  });

  expect(stopHeartbeat).toHaveBeenCalledOnce();
  expect(boss.stop).toHaveBeenCalledWith({
    graceful: true,
    timeout: 30_000,
  });
  expect(database.$client.end).toHaveBeenCalledOnce();
});

test("closes the database even when pg-boss shutdown fails", async () => {
  const database = {
    $client: {
      end: vi.fn().mockResolvedValue(undefined),
    },
  };

  await expect(
    closeWorkerResources({
      stopHeartbeat: vi.fn(),
      boss: {
        stop: vi.fn().mockRejectedValue(new Error("boss stop failed")),
      },
      database,
    }),
  ).rejects.toThrow("boss stop failed");

  expect(database.$client.end).toHaveBeenCalledOnce();
});
