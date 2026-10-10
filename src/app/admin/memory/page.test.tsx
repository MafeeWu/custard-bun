import { render, screen, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { requireAdmin } from "@/server/admin/require-admin";
import { getMemoryOperationsDashboard } from "@/server/admin/memory-operations-queries";
import { getGlobalMemorySettings } from "@/server/admin/memory-settings-service";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/server/admin/require-admin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/server/db/database", () => ({ getDatabase: async () => ({}) }));
vi.mock("@/server/admin/memory-operations-queries", () => ({
  getMemoryOperationsDashboard: vi.fn(),
  getMemoryRetryCandidates: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/server/admin/memory-settings-service", () => ({
  getGlobalMemorySettings: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdmin).mockResolvedValue({
    userId: "admin", label: "administrator", operationId: "op",
  });
  vi.mocked(getGlobalMemorySettings).mockResolvedValue({ enabled: true, revision: 2 });
  vi.mocked(getMemoryOperationsDashboard).mockResolvedValue({
    jobs: { pending: 2, running: 1, retrying: 0, failed: 1, deadLetter: 3 },
    processingDelayMs: { p50: 100, p95: 200 },
    tokens: { input: 321, output: 123, estimatedRows: 2 },
    exports: { active: 1, expiredBytes: 64 },
    purges: [{ stage: "settle", count: 2, oldestAt: new Date("2026-10-01T00:00:00Z") }],
    failures: [{ category: "internal", count: 1 }],
    oldestPendingAt: null,
    exportStates: [],
  });
});

test("renders aggregate cards and tables without private content", async () => {
  const Page = (await import("./page")).default;
  render(await Page());
  expect(screen.getByRole("heading", { level: 1, name: "Memory operations" })).toBeVisible();
  expect(screen.getByText(/321 input/)).toBeVisible();
  expect(screen.getByText(/64 bytes/)).toBeVisible();
  expect(within(screen.getByRole("table", { name: "Purge stages" })).getByText("settle")).toBeVisible();
  expect(within(screen.getByRole("table", { name: "Operation failures" })).getByText("internal")).toBeVisible();
  expect(document.body.textContent).not.toMatch(/transcript|memory content|summary content|archive bytes|provider key|model endpoint/i);
});

test("ordinary users cannot render or query operations", async () => {
  vi.mocked(requireAdmin).mockRejectedValue(new Error("notFound"));
  const Page = (await import("./page")).default;
  await expect(Page()).rejects.toThrow("notFound");
  expect(getMemoryOperationsDashboard).not.toHaveBeenCalled();
});
