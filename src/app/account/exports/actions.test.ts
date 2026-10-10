import { expect, test, vi } from "vitest";
import {
  requestDataExport,
  retryDataExport,
  getDataExportForUser,
} from "@/server/privacy/data-export-service";
import {
  requestDataExportAction,
  retryDataExportAction,
  getDataExportStatusAction,
} from "./actions";
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/auth/require-session", () => ({
  requireSession: async () => ({ user: { id: "current-owner" } }),
}));
vi.mock("@/server/db/database", () => ({ getDatabase: async () => ({}) }));
vi.mock("@/server/privacy/data-export-service", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/server/privacy/data-export-service")
  >()),
  requestDataExport: vi.fn(),
  retryDataExport: vi.fn(),
  getDataExportForUser: vi.fn(),
}));
test("request and retry derive ownership from session, not form fields", async () => {
  vi.mocked(requestDataExport).mockResolvedValue({ exportId: "export" });
  vi.mocked(retryDataExport).mockResolvedValue({ exportId: "export" });
  const form = new FormData();
  form.set("userId", "other-user");
  form.set("exportId", "export");
  expect(await requestDataExportAction({ status: "idle" }, form)).toMatchObject(
    { status: "success", exportId: "export" },
  );
  expect(requestDataExport).toHaveBeenCalledWith(
    {},
    { userId: "current-owner", now: expect.any(Date) },
  );
  await retryDataExportAction({ status: "idle" }, form);
  expect(retryDataExport).toHaveBeenCalledWith(
    {},
    { userId: "current-owner", exportId: "export", now: expect.any(Date) },
  );
});
test("actions and polling do not expose private errors", async () => {
  vi.mocked(requestDataExport).mockRejectedValue(
    new Error("private model secret"),
  );
  expect(
    await requestDataExportAction({ status: "idle" }, new FormData()),
  ).toEqual({
    status: "error",
    message: "Unable to request data export. Try again.",
  });
  vi.mocked(getDataExportForUser).mockResolvedValue(null);
  expect(await getDataExportStatusAction("other-export")).toBeNull();
  expect(getDataExportForUser).toHaveBeenCalledWith(
    {},
    {
      userId: "current-owner",
      exportId: "other-export",
      now: expect.any(Date),
    },
  );
});
