import { render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { requireAdmin } from "@/server/admin/require-admin";
import { listAdminAuditEvents } from "@/server/admin/audit-queries";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/server/admin/require-admin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/server/db/database", () => ({
  getDatabase: async () => ({ db: true }),
}));
vi.mock("@/server/admin/audit-queries", () => ({
  listAdminAuditEvents: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdmin).mockResolvedValue({
    userId: "admin",
    label: "admin@example.com",
    operationId: "op",
  });
});

test("renders safe audit event summaries without prompt or reason content", async () => {
  vi.mocked(listAdminAuditEvents).mockResolvedValue({
    total: 51,
    events: [
      {
        actorLabel: "admin@example.com",
        action: "user.disable",
        targetType: "user",
        targetId: "user-1",
        metadata: {
          previousState: "active",
          nextState: "disabled",
          reason: "Repeated abuse",
          prompt: "full prompt",
          memory: "memory content",
          providerKey: "private-provider-key",
        },
        operationId: "op-1",
        createdAt: new Date("2026-10-08T01:02:03Z"),
      },
    ],
  } as never);
  const Page = (await import("./page")).default;

  render(await Page({ searchParams: Promise.resolve({ page: "1" }) }));

  expect(requireAdmin).toHaveBeenCalled();
  expect(listAdminAuditEvents).toHaveBeenCalledWith(
    { db: true },
    { page: 1, pageSize: 50 },
  );
  expect(
    screen.getByRole("heading", { level: 1, name: "Admin audit log" }),
  ).toBeVisible();
  expect(screen.getAllByText("user.disable")[0]).toBeVisible();
  expect(screen.getAllByText("user:user-1")[0]).toBeVisible();
  expect(screen.getAllByText("2026-10-08T01:02:03.000Z")[0]).toBeVisible();
  expect(screen.getAllByText(/previousState/)[0]).toHaveTextContent("disabled");
  expect(screen.getAllByText("op-1")[0]).toBeVisible();
  expect(
    screen.queryByText(
      /Repeated abuse|full prompt|ban reason|memory content|private-provider-key/i,
    ),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Next page" })).toHaveAttribute(
    "href",
    "/admin/audit?page=2",
  );
});
