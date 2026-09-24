import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import VerifyEmailPage from "./page";

vi.mock("@/server/config/public-config", () => ({
  getPublicConfig: async () => ({
    branding: { name: "Test", logoPath: "/brand/logo.svg" },
    links: {
      privacyUrl: "/privacy",
      termsUrl: "/terms",
      supportUrl: "/support",
    },
  }),
}));

test.each(["TOKEN_EXPIRED", "INVALID_TOKEN", "private-untrusted-error"])(
  "verification failure %s uses safe actionable copy",
  async (error) => {
    render(await VerifyEmailPage({ searchParams: Promise.resolve({ error }) }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      /verification link is invalid or has expired/i,
    );
    expect(
      screen.queryByText(/private-untrusted-error/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Open the verification link we sent/),
    ).not.toBeInTheDocument();
  },
);
