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
  UserQuotaForm: vi.fn(() => null),
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
vi.mock("@/components/admin/users/user-quota-form", () => ({
  UserQuotaForm: usersPageMocks.UserQuotaForm,
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
        dailyRequestLimit: 25,
        dailyTokenLimit: null,
        currentPeriodRequests: 3,
        currentPeriodTokens: 400,
      },
      {
        id: "user-2",
        name: "Disabled Two",
        email: "two@example.com",
        createdAt: new Date("2026-10-07T01:02:03Z"),
        banned: true,
        dailyRequestLimit: null,
        dailyTokenLimit: 5_000,
        currentPeriodRequests: 1,
        currentPeriodTokens: 50,
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
  const table = screen.getByRole("table", { name: "Ordinary users" });
  for (const header of [
    "Name",
    "Email",
    "Created",
    "Status",
    "Current UTC-day usage",
    "Quota override",
    "Access",
  ]) {
    expect(
      within(table).getByRole("columnheader", { name: header }),
    ).toBeVisible();
  }
  expect(
    screen.getByRole("list", { name: "Ordinary users mobile cards" }),
  ).toBeInTheDocument();
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
  expect(within(rows[1]!).getByText("3 requests / 400 tokens")).toBeVisible();
  expect(usersPageMocks.UserQuotaForm).toHaveBeenCalledWith(
    expect.objectContaining({
      user: expect.objectContaining({
        id: "user-1",
        dailyRequestLimit: 25,
        dailyTokenLimit: null,
      }),
    }),
    undefined,
  );
  expect(
    screen.queryByText(/conversation|transcript|message content/i),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Next page" })).toHaveAttribute(
    "href",
    "/admin/users?q=one&page=2",
  );
});
