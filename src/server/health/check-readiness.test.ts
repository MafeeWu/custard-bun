// @vitest-environment node
import { expect, test, vi } from "vitest";
import { checkReadiness } from "./check-readiness";

test("reports ready only when database and worker heartbeat succeed", async () => {
  const result = await checkReadiness({
    checkDatabase: vi.fn().mockResolvedValue(undefined),
    checkWorker: vi.fn().mockResolvedValue(undefined),
  });

  expect(result).toEqual({
    ready: true,
    checks: { database: "ok", worker: "ok" },
  });
});

test("reports failed dependencies without exposing their errors", async () => {
  const result = await checkReadiness({
    checkDatabase: vi
      .fn()
      .mockRejectedValue(new Error("postgresql://user:secret@db/app refused")),
    checkWorker: vi.fn().mockRejectedValue(new Error("private worker detail")),
  });

  expect(result).toEqual({
    ready: false,
    checks: { database: "error", worker: "error" },
  });
  expect(JSON.stringify(result)).not.toContain("secret");
  expect(JSON.stringify(result)).not.toContain("private");
});
