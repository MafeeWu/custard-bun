import { render, screen, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { requireAdmin } from "@/server/admin/require-admin";
import { listOrdinaryUsers } from "@/server/admin/user-queries";

type UserStatusFormProps = {
  user: unknown;
};

const usersPageMocks = vi.hoisted(() => ({
  UserStatusForm: vi.fn((props: UserStatusFormProps) => {
    void props;
    return null;
  }),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/server/admin/require-admin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/server/db/database", () => ({
  getDatabase: async () => ({ db: true }),
}));
vi.mock("@/server/admin/user-queries", () => ({ listOrdinaryUsers: vi.fn() }));
vi.mock("@/components/admin/users/user-status-form", () => ({
  UserStatusForm: usersPageMocks.UserStatusForm,
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdmin).mockResolvedValue({
    userId: "admin",
    label: "admin@example.com",
    operationId: "op",
  });
});

test("renders a searchable paginated ordinary-user table with safe controls", async () => {
  vi.mocked(listOrdinaryUsers).mockResolvedValue({
    total: 26,
    users: [
      {
        id: "user-1",
        name: "Ordinary One",
        email: "one@example.com",
        createdAt: new Date("2026-10-08T01:02:03Z"),
        banned: false,
      },
      {
        id: "user-2",
        name: "Disabled Two",
        email: "two@example.com",
        createdAt: new Date("2026-10-07T01:02:03Z"),
        banned: true,
      },
    ],
  } as never);
  const Page = (await import("./page")).default;

  render(
    await Page({ searchParams: Promise.resolve({ q: "one", page: "1" }) }),
  );

  expect(requireAdmin).toHaveBeenCalled();
  expect(listOrdinaryUsers).toHaveBeenCalledWith(
    { db: true },
    { query: "one", page: 1, pageSize: 25 },
  );
  expect(
    screen.getByRole("heading", { level: 1, name: "User access" }),
  ).toBeVisible();
  expect(screen.getByRole("searchbox", { name: "Search users" })).toHaveValue(
    "one",
  );
  const rows = screen.getAllByRole("row");
  expect(within(rows[1]!).getByText("Ordinary One")).toBeVisible();
  expect(within(rows[1]!).getByText("Active")).toBeVisible();
  expect(within(rows[2]!).getByText("Disabled")).toBeVisible();
  expect(
    screen.queryByText(/role|impersonate|password|delete/i),
  ).not.toBeInTheDocument();
  expect(usersPageMocks.UserStatusForm).toHaveBeenCalledWith(
    expect.objectContaining({
      user: expect.objectContaining({ id: "user-1" }),
    }),
    undefined,
  );
  expect(screen.getByRole("link", { name: "Next page" })).toHaveAttribute(
    "href",
    "/admin/users?q=one&page=2",
  );
});
