import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { requireAdmin } from "@/server/admin/require-admin";
import AdminLayout from "./layout";
import AdminPage from "./page";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

vi.mock("@/server/admin/require-admin", () => ({
  requireAdmin: vi.fn(),
}));

test("renders the protected administration shell and overview", async () => {
  vi.mocked(requireAdmin).mockResolvedValue({
    userId: "admin-1",
    label: "a@example.com",
    operationId: "op-1",
  } as never);

  const element = await AdminLayout({ children: AdminPage() });
  render(element);

  expect(
    screen.getByRole("navigation", { name: /administration/i }),
  ).toBeVisible();
  expect(screen.getByRole("link", { name: "Characters" })).toHaveAttribute(
    "href",
    "/admin/characters",
  );
  expect(screen.getByRole("link", { name: "Users" })).toHaveAttribute(
    "href",
    "/admin/users",
  );
  expect(screen.getByRole("link", { name: "Audit" })).toHaveAttribute(
    "href",
    "/admin/audit",
  );
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
    "Administration",
  );
  expect(
    screen.getByText(/review characters, user access, and audit history/i),
  ).toBeVisible();
});
