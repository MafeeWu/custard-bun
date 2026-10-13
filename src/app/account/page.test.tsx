import { render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { requireSession } from "@/server/auth/require-session";
import { getPublicConfig } from "@/server/config/public-config";
import type { PublicAppConfig } from "@/server/config/schema";
import AccountPage from "./page";
import { listMemoryRelationships } from "@/server/memory/memory-queries";
vi.mock("@/server/db/database", () => ({ getDatabase: async () => ({}) }));
vi.mock("@/server/privacy/data-export-service", () => ({
  listDataExportsForUser: vi.fn(async () => []),
}));
vi.mock("@/server/config/public-config", () => ({
  getPublicConfig: vi.fn(),
}));
vi.mock("@/components/account/data-export-panel", () => ({
  DataExportPanel: () => (
    <section aria-labelledby="data-export-heading">
      <h2 id="data-export-heading">Export your data</h2>
      <p>Request data export</p>
    </section>
  ),
}));
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
    <section aria-labelledby="delete-account-heading">
      <h2 id="delete-account-heading">Delete account</h2>
      <p>{email}</p>
    </section>
  ),
}));

function createPublicConfig(): PublicAppConfig {
  return {
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
    chat: {
      firstTokenTimeoutMs: 10_000,
      requestTimeoutMs: 60_000,
      promptTokenBudget: 8_192,
      maxInputCharacters: 12_000,
      maxOutputTokens: 1_024,
      defaultUserDailyRequestLimit: 50,
      defaultUserDailyTokenLimit: 50_000,
      defaultInstanceMonthlyRequestLimit: 5_000,
      defaultInstanceMonthlyTokenBudget: 2_000_000,
      maxConcurrentGenerations: 4,
    },
    memory: {
      enabled: true,
      promptTokenBudget: 1_024,
      relationshipSummaryTokenBudget: 256,
      memoryItemsTokenBudget: 512,
      maxActiveItemsPerCharacter: 100,
      maxItemCharacters: 280,
      maxSummaryCharacters: 2_000,
      extractionRetryLimit: 3,
      extractionRetryDelaySeconds: 60,
      exportRetentionHours: 24,
      maxExportArchiveBytes: 262_144,
    },
  };
}

beforeEach(() => {
  vi.mocked(getPublicConfig).mockResolvedValue(createPublicConfig());
});

test("shows grouped account, privacy, export, deletion, and legal surfaces without exposing private identifiers", async () => {
  vi.mocked(requireSession).mockResolvedValue({
    user: {
      id: "owner-private-id",
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
  expect(
    screen.getByRole("heading", { level: 2, name: "Profile and session" }),
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
  expect(
    screen.getByRole("heading", { level: 2, name: "Delete account" }),
  ).toBeVisible();
  expect(
    screen.getByRole("heading", { level: 2, name: "Privacy" }),
  ).toBeVisible();
  expect(
    screen.getByRole("link", { name: "Manage all character memories" }),
  ).toHaveAttribute("href", "/app/memories");
  expect(listMemoryRelationships).toHaveBeenCalledWith({}, "owner-private-id");
  expect(screen.getByRole("link", { name: "Mira" })).toHaveAttribute(
    "href",
    "/app/memories/character-1",
  );
  expect(screen.getByText(/Chat usage stopped/)).toBeVisible();
  expect(
    screen.getByRole("heading", { level: 2, name: "Export your data" }),
  ).toBeVisible();
  expect(
    screen.getByRole("heading", { level: 2, name: "Delete account" }),
  ).toBeVisible();
  expect(
    screen.getByRole("heading", { level: 2, name: "Legal and support" }),
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
  expect(screen.queryByText("owner-private-id")).not.toBeInTheDocument();
});
