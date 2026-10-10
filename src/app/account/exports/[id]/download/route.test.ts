// @vitest-environment node
import { expect, test, vi } from "vitest";
import { getAuth } from "@/server/auth/auth";
import { downloadDataExport } from "@/server/privacy/data-export-service";
import { GET } from "./route";
vi.mock("@/server/auth/auth", () => ({ getAuth: vi.fn() }));
vi.mock("@/server/db/database", () => ({ getDatabase: async () => ({}) }));
vi.mock("@/server/privacy/data-export-service", () => ({
  downloadDataExport: vi.fn(),
}));
const exportId = "00000000-0000-4000-8000-000000000000";
const invoke = (id = exportId) =>
  GET(new Request("http://localhost/account/exports/" + id + "/download"), {
    params: Promise.resolve({ id }),
  });
function auth(owner: unknown = { id: "owner" }) {
  const getSession = vi.fn(async () => (owner ? { user: owner } : null));
  vi.mocked(getAuth).mockResolvedValue({ api: { getSession } } as never);
  return getSession;
}
test("download uses current session and exact private ZIP headers", async () => {
  const getSession = auth();
  vi.mocked(downloadDataExport).mockResolvedValue({
    bytes: Buffer.from("ZIP"),
    size: 3,
  });
  const response = await invoke();
  expect(getSession).toHaveBeenCalledWith({
    headers: expect.any(Headers),
    query: { disableCookieCache: true },
  });
  expect(downloadDataExport).toHaveBeenCalledWith(
    {},
    { userId: "owner", exportId, now: expect.any(Date) },
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("application/zip");
  expect(response.headers.get("Content-Disposition")).toBe(
    `attachment; filename="custard-bun-export-${exportId}.zip"`,
  );
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(await response.text()).toBe("ZIP");
});
test.each([
  "anonymous",
  "banned",
  "deleting",
  "other",
  "expired",
  "cancelled",
  "corrupt",
  "invalid",
])("%s download is a private 404", async (state) => {
  auth(
    state === "anonymous"
      ? null
      : {
          id: "owner",
          banned: state === "banned",
          deletionPendingAt: state === "deleting" ? new Date() : null,
        },
  );
  vi.mocked(downloadDataExport).mockResolvedValue(null);
  const response = await invoke(state === "invalid" ? "../bad" : exportId);
  expect(response.status).toBe(404);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
});
test("unexpected storage/auth failures return a safe noncacheable response", async () => {
  auth();
  vi.mocked(downloadDataExport).mockRejectedValue(
    new Error("private database secret"),
  );
  const response = await invoke();
  expect(response.status).toBe(404);
  expect(await response.text()).not.toContain("private");
});
