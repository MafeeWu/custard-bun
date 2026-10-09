// @vitest-environment node
import { expect, test, vi } from "vitest";
import { checkReadiness } from "./check-readiness";

test("reports ready only when database and worker heartbeat succeed", async () => {
  const result = await checkReadiness({
    checkDatabase: vi.fn().mockResolvedValue(undefined),
    checkWorker: vi.fn().mockResolvedValue(undefined),
    checkModelConfiguration: vi.fn().mockResolvedValue(undefined),
  });

  expect(result).toEqual({
    ready: true,
    checks: { database: "ok", worker: "ok", modelConfiguration: "ok" },
  });
});

test("reports failed dependencies without exposing their errors", async () => {
  const result = await checkReadiness({
    checkDatabase: vi
      .fn()
      .mockRejectedValue(new Error("postgresql://user:secret@db/app refused")),
    checkWorker: vi.fn().mockRejectedValue(new Error("private worker detail")),
    checkModelConfiguration: vi
      .fn()
      .mockRejectedValue(new Error("private provider detail")),
  });

  expect(result).toEqual({
    ready: false,
    checks: {
      database: "error",
      worker: "error",
      modelConfiguration: "error",
    },
  });
  expect(JSON.stringify(result)).not.toContain("secret");
  expect(JSON.stringify(result)).not.toContain("private");
});

test("validates only local model configuration and never calls the provider", async () => {
  const providerCall = vi.fn();
  const checkModelConfiguration = vi.fn().mockResolvedValue(undefined);

  const result = await checkReadiness({
    checkDatabase: vi.fn().mockResolvedValue(undefined),
    checkWorker: vi.fn().mockResolvedValue(undefined),
    checkModelConfiguration,
  });

  expect(result).toEqual({
    ready: true,
    checks: {
      database: "ok",
      worker: "ok",
      modelConfiguration: "ok",
    },
  });
  expect(checkModelConfiguration).toHaveBeenCalledOnce();
  expect(providerCall).not.toHaveBeenCalled();
});
