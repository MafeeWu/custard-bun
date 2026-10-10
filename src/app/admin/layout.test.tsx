import { render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { requireAdmin } from "@/server/admin/require-admin";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/server/admin/require-admin", () => ({ requireAdmin: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdmin).mockResolvedValue({
    userId: "admin",
    label: "admin@example.com",
    operationId: "op",
  });
});

test("includes the aggregate usage administration link", async () => {
  const Layout = (await import("./layout")).default;
  render(await Layout({ children: <p>content</p> }));

  expect(screen.getByRole("link", { name: "Usage" })).toHaveAttribute(
    "href",
    "/admin/usage",
  );
  expect(screen.getByRole("link", { name: "Memory operations" })).toHaveAttribute(
    "href",
    "/admin/memory",
  );
});
