import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { requireSession } from "@/server/auth/require-session";
import AccountPage from "./page";
import { listMemoryRelationships } from "@/server/memory/memory-queries";
vi.mock("@/server/db/database", () => ({ getDatabase: async () => ({}) }));
vi.mock("@/server/memory/memory-queries", () => ({
  listMemoryRelationships: vi.fn(async () => [
    {
      character: { id: "character-1", displayName: "Mira" },
      itemCount: 2,
      recordingEnabled: true,
      usageEnabled: false,
    },
  ]),
}));

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
      id: "owner",
      name: "Person",
      email: "person@example.com",
      emailVerified: false,
    },
  } as never);

  const element = await AccountPage();
  render(element);

  expect(
    screen.getByRole("heading", { level: 1, name: "Account" }),
  ).toBeVisible();
  expect(screen.getByText("Person")).toBeVisible();
  expect(
    screen.getByText("person@example.com", { selector: "dd" }),
  ).toBeVisible();
  expect(screen.getByText("Unverified")).toBeVisible();
  expect(screen.getByRole("link", { name: "Reset password" })).toHaveAttribute(
    "href",
    "/auth/forgot-password",
  );
  expect(screen.getByTestId("delete-account-form")).toHaveTextContent(
    "person@example.com",
  );
  expect(
    screen.getByRole("link", { name: "Manage all character memories" }),
  ).toHaveAttribute("href", "/app/memories");
  expect(listMemoryRelationships).toHaveBeenCalledWith({}, "owner");
  expect(screen.getByRole("link", { name: "Mira" })).toHaveAttribute(
    "href",
    "/app/memories/character-1",
  );
  expect(screen.getByText(/Chat usage stopped/)).toBeVisible();
});
