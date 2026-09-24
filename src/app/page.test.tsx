import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { expect, test } from "vitest";
import HomePage from "./page";

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

test("renders a single primary action", async () => {
  const element = await HomePage();
  render(element);

  expect(screen.getByRole("heading", { level: 1 })).toBeVisible();
  expect(screen.getByRole("link", { name: /get started/i })).toHaveAttribute(
    "href",
    "/auth/sign-up",
  );
});
