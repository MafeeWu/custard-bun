import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { requireSession } from "@/server/auth/require-session";
import AccountPage from "./page";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

vi.mock("@/server/auth/require-session", () => ({
  requireSession: vi.fn(),
}));

vi.mock("@/components/account/delete-account-form", () => ({
  DeleteAccountForm: ({ email }: { email: string }) => (
    <div data-testid="delete-account-form">{email}</div>
  ),
}));

test("shows the current account details and deletion form", async () => {
  vi.mocked(requireSession).mockResolvedValue({
    user: {
      name: "Person",
      email: "person@example.com",
      emailVerified: false,
    },
  } as never);

  const element = await AccountPage();
  render(element);

  expect(screen.getByRole("heading", { level: 1, name: "Account" })).toBeVisible();
  expect(screen.getByText("Person")).toBeVisible();
  expect(screen.getByText("person@example.com", { selector: "dd" })).toBeVisible();
  expect(screen.getByText("Unverified")).toBeVisible();
  expect(screen.getByRole("link", { name: "Reset password" })).toHaveAttribute(
    "href",
    "/auth/forgot-password",
  );
  expect(screen.getByTestId("delete-account-form")).toHaveTextContent(
    "person@example.com",
  );
});
