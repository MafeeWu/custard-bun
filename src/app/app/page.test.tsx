import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { requireSession } from "@/server/auth/require-session";
import ApplicationHomePage from "./page";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

vi.mock("@/server/auth/require-session", () => ({
  requireSession: vi.fn(),
}));

vi.mock("@/components/auth/sign-out-button", () => ({
  SignOutButton: () => <button type="button">Sign out</button>,
}));

test("renders account and character catalog navigation from the application page", async () => {
  vi.mocked(requireSession).mockResolvedValue({
    user: {
      name: "Person",
      email: "person@example.com",
      emailVerified: true,
    },
  } as never);

  const element = await ApplicationHomePage();
  render(element);

  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
    "Welcome, Person",
  );
  expect(screen.getByRole("link", { name: "Account" })).toHaveAttribute(
    "href",
    "/account",
  );
  expect(
    screen.getByRole("link", { name: /browse characters/i }),
  ).toHaveAttribute("href", "/characters");
});
