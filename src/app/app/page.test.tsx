import { render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { getPublicConfig } from "@/server/config/public-config";
import type { PublicAppConfig } from "@/server/config/schema";
import { requireSession } from "@/server/auth/require-session";
import { listActiveConversations } from "@/server/chat/conversation-queries";
import ApplicationHomePage from "./page";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

vi.mock("@/server/auth/require-session", () => ({
  requireSession: vi.fn(),
}));

vi.mock("@/server/config/public-config", () => ({
  getPublicConfig: vi.fn(),
}));

vi.mock("@/server/db/database", () => ({
  getDatabase: vi.fn(async () => ({})),
}));

vi.mock("@/server/chat/conversation-queries", () => ({
  listActiveConversations: vi.fn(),
}));

vi.mock("@/components/auth/sign-out-button", () => ({
  SignOutButton: () => <button type="button">Sign out</button>,
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

test("prefers the display name, renders continuation links, and keeps shell navigation out of page actions", async () => {
  vi.mocked(getPublicConfig).mockResolvedValue(createPublicConfig());
  vi.mocked(requireSession).mockResolvedValue({
    user: {
      id: "user-1",
      name: "Person",
      email: "person@example.com",
      emailVerified: true,
      role: "user",
    },
  } as never);
  vi.mocked(listActiveConversations).mockResolvedValue([
    {
      id: "conversation-1",
      character: {
        id: "character-1",
        slug: "calm-guide",
        displayName: "Calm Guide",
        avatarPath: "/calm.svg",
        pinnedVersionId: "version-1",
        isCurrentDefault: true,
      },
      lastMessageAt: new Date("2026-10-09T10:00:00Z"),
    },
  ]);

  const element = await ApplicationHomePage();
  render(element);

  expect(
    screen.getByRole("heading", { level: 1, name: "Conversations" }),
  ).toBeVisible();
  expect(screen.getByText("Person")).toBeVisible();
  expect(screen.queryByText("person@example.com")).not.toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "Continue with Calm Guide" }),
  ).toHaveAttribute("href", "/app/conversations/conversation-1");
  expect(
    screen.getByRole("link", { name: "Browse characters" }),
  ).toHaveAttribute("href", "/characters");
  expect(screen.queryByRole("link", { name: "Memories" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Account" })).toBeNull();

  const accountArea = screen.getByRole("complementary", { name: "Account" });
  expect(
    within(accountArea).getByRole("button", { name: "Sign out" }),
  ).toBeVisible();
  expect(listActiveConversations).toHaveBeenCalledWith({}, "user-1");
});

test("renders the composed empty state with one browse action and no duplicate page navigation", async () => {
  vi.mocked(getPublicConfig).mockResolvedValue(createPublicConfig());
  vi.mocked(requireSession).mockResolvedValue({
    user: {
      id: "user-1",
      name: "Person",
      email: "person@example.com",
      emailVerified: true,
      role: "user",
    },
  } as never);
  vi.mocked(listActiveConversations).mockResolvedValue([]);

  const element = await ApplicationHomePage();
  render(element);

  expect(
    screen.getByRole("heading", {
      level: 2,
      name: "No active conversations yet",
    }),
  ).toBeVisible();
  expect(screen.getByRole("img", { name: "Custard Bun logo" })).toBeVisible();
  expect(
    screen.getAllByRole("link", { name: "Browse characters" }),
  ).toHaveLength(1);
  expect(screen.queryByRole("link", { name: "Memories" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Account" })).toBeNull();
  expect(screen.getByRole("complementary", { name: "Account" })).toBeVisible();
});

test("keeps long names intact while preserving the continuation link accessible name", async () => {
  const longUserName = "A".repeat(60);
  const longCharacterName = "B".repeat(60);

  vi.mocked(getPublicConfig).mockResolvedValue(createPublicConfig());
  vi.mocked(requireSession).mockResolvedValue({
    user: {
      id: "user-1",
      name: longUserName,
      email: "person@example.com",
      emailVerified: true,
      role: "user",
    },
  } as never);
  vi.mocked(listActiveConversations).mockResolvedValue([
    {
      id: "conversation-1",
      character: {
        id: "character-1",
        slug: "steady-orbit",
        displayName: longCharacterName,
        avatarPath: "/steady.svg",
        pinnedVersionId: "version-1",
        isCurrentDefault: true,
      },
      lastMessageAt: new Date("2026-10-09T10:00:00Z"),
    },
  ]);

  const element = await ApplicationHomePage();
  render(element);

  expect(screen.getByText(longUserName)).toBeVisible();
  expect(screen.getByText(longCharacterName)).toBeVisible();
  expect(
    screen.getByRole("link", {
      name: `Continue with ${longCharacterName}`,
    }),
  ).toBeVisible();
});
