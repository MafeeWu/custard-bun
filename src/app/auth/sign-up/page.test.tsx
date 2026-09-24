import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { expect, test } from "vitest";
import SignUpPage from "./page";

vi.mock("@/server/config/public-config", () => ({
  getPublicConfig: async () => ({
    branding: {
      name: "Custard Bun",
      description: "Private conversations with consistent AI characters.",
      logoPath: "/brand/logo.svg",
      faviconPath: "/brand/favicon.svg",
      primaryColor: "#F59E0B",
    },
    registration: { open: false, maxAttemptsPerHourPerIp: 5 },
    links: {
      privacyUrl: "https://example.com/privacy",
      termsUrl: "https://example.com/terms",
      supportUrl: "mailto:support@example.com",
    },
  }),
}));

test("reads the registration policy on the server and passes it to the form", async () => {
  const element = await SignUpPage();

  render(element);

  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
    /create your custard bun account/i,
  );
  expect(
    screen.getByText(/registration is currently closed/i),
  ).toBeVisible();
});
