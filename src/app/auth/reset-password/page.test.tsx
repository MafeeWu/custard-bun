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

test("shows an alert for a missing reset token", async () => {
  const element = await ResetPasswordPage({
    searchParams: Promise.resolve({}),
  });

  render(element);

  expect(screen.getByRole("alert")).toHaveTextContent(
    /this reset link is invalid or has expired/i,
  );
});
