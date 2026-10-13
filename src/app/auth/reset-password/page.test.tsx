import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { expect, test } from "vitest";
import ResetPasswordPage from "./page";

vi.mock("@/server/config/public-config", () => ({
  getPublicConfig: async () => ({
    branding: {
      name: "Custard Bun",
      description: "Private conversations with consistent AI characters.",
      logoPath: "/brand/logo.svg",
      faviconPath: "/brand/favicon.svg",
      primaryColor: "#F59E0B",
    },
    registration: { open: true, maxAttemptsPerHourPerIp: 5 },
    links: {
      privacyUrl: "https://example.com/privacy",
      termsUrl: "https://example.com/terms",
      supportUrl: "mailto:support@example.com",
    },
  }),
}));

test("shows an alert for a missing reset token and preserves legal links inside the auth shell", async () => {
  const element = await ResetPasswordPage({
    searchParams: Promise.resolve({}),
  });

  render(element);

  expect(screen.getByRole("alert")).toHaveTextContent(
    /this reset link is invalid or has expired/i,
  );
  expect(
    screen.getByRole("complementary", { name: "Brand context" }),
  ).toBeVisible();
  expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute(
    "href",
    "https://example.com/privacy",
  );
  expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute(
    "href",
    "https://example.com/terms",
  );
  expect(screen.getByRole("link", { name: "Support" })).toHaveAttribute(
    "href",
    "mailto:support@example.com",
  );
});
