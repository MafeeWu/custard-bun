import { beforeEach, expect, test, vi } from "vitest";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/server/admin/require-admin";
import { retryDeadLetterOperation } from "@/server/admin/memory-operations-service";
import { updateGlobalMemorySettings, MemorySettingsAdminError } from "@/server/admin/memory-settings-service";
import { retryMemoryOperationAction, updateGlobalMemorySettingsAction } from "./actions";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/admin/require-admin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/server/db/database", () => ({ getDatabase: async () => ({}) }));
vi.mock("@/server/admin/memory-operations-service", () => ({
  retryDeadLetterOperation: vi.fn(),
  MemoryOperationAdminError: class extends Error {
    code: string;
    constructor(code: string) { super(code); this.code = code; }
  },
}));
vi.mock("@/server/admin/memory-settings-service", () => ({
  updateGlobalMemorySettings: vi.fn(),
  resetGlobalMemorySettings: vi.fn(),
  MemorySettingsAdminError: class extends Error {
    code: string;
    constructor(code: string) { super(code); this.code = code; }
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdmin).mockResolvedValue({
    userId: "admin", label: "administrator", operationId: "op",
  });
});

test("preserves settings form values on validation and revision conflict", async () => {
  const form = new FormData();
  form.set("expectedRevision", "2");
  form.set("enabled", "invalid");
  const invalid = await updateGlobalMemorySettingsAction({ status: "idle" }, form);
  expect(invalid).toMatchObject({ status: "error", values: { expectedRevision: "2", enabled: "invalid" } });
  expect(updateGlobalMemorySettings).not.toHaveBeenCalled();
  form.set("enabled", "false");
  vi.mocked(updateGlobalMemorySettings).mockRejectedValue(new MemorySettingsAdminError("SETTINGS_CONFLICT"));
  const conflict = await updateGlobalMemorySettingsAction({ status: "idle" }, form);
  expect(conflict).toMatchObject({ status: "error", values: { expectedRevision: "2", enabled: "false" } });
  expect(revalidatePath).not.toHaveBeenCalled();
});

test("retry maps safe conflicts and revalidates both operator dashboards", async () => {
  const form = new FormData();
  form.set("operationType", "memory_extraction");
  form.set("operationId", "00000000-0000-4000-8000-000000000001");
  vi.mocked(retryDeadLetterOperation).mockResolvedValue(undefined);
  expect(await retryMemoryOperationAction({ status: "idle" }, form)).toMatchObject({ status: "success" });
  expect(revalidatePath).toHaveBeenCalledWith("/admin/memory");
  expect(revalidatePath).toHaveBeenCalledWith("/admin/usage");
  vi.mocked(retryDeadLetterOperation).mockRejectedValue(new Error("PRIVATE SOURCE"));
  const failure = await retryMemoryOperationAction({ status: "idle" }, form);
  expect(JSON.stringify(failure)).not.toContain("PRIVATE SOURCE");
});
