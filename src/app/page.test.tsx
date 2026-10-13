import { render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import type { PublicCharacterSummary } from "@/server/characters/character-queries";
import { listPublicCharacters } from "@/server/characters/character-queries";
import { getPublicConfig } from "@/server/config/public-config";
import type { PublicAppConfig } from "@/server/config/schema";
import { getDatabase } from "@/server/db/database";
import HomePage from "./page";

vi.mock("@/server/config/public-config", () => ({
  getPublicConfig: vi.fn(),
}));

vi.mock("@/server/db/database", () => ({
  getDatabase: vi.fn(),
}));

vi.mock("@/server/characters/character-queries", () => ({
  listPublicCharacters: vi.fn(),
}));

function createPublicConfig(registrationOpen = true): PublicAppConfig {
  return {
    branding: {
      name: "Custard Bun",
      description: "Private conversations with consistent AI characters.",
      logoPath: "/brand/logo.svg",
      faviconPath: "/brand/favicon.svg",
      primaryColor: "#F59E0B",
    },
    registration: { open: registrationOpen, maxAttemptsPerHourPerIp: 5 },
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

function createCharacters(): PublicCharacterSummary[] {
  return [
    {
      id: "11111111-1111-1111-1111-111111111111",
      slug: "astrid",
      displayName: "Astrid Vale",
      avatarPath: "/characters/astrid-vale.png",
      shortDescription: "A precise observer who keeps context tidy.",
      openingMessage: "We can start with the thread you care about most.",
    },
    {
      id: "22222222-2222-2222-2222-222222222222",
      slug: "mika",
      displayName: "Mika Rowan",
      avatarPath: "/characters/mika-rowan.png",
      shortDescription: "A warm collaborator with a steady memory.",
      openingMessage: "Tell me what should stay consistent this time.",
    },
    {
      id: "33333333-3333-3333-3333-333333333333",
      slug: "sol",
      displayName: "Sol Finch",
      avatarPath: "/characters/sol-finch.png",
      shortDescription: "A candid guide who remembers the shape of a story.",
      openingMessage: "I can pick back up exactly where you left it.",
    },
    {
      id: "44444444-4444-4444-4444-444444444444",
      slug: "juniper",
      displayName: "Juniper Lane",
      avatarPath: "/characters/juniper-lane.png",
      shortDescription: "A reflective partner for slower conversations.",
      openingMessage: "What should we protect as this conversation grows?",
    },
  ];
}

beforeEach(() => {
  vi.mocked(getDatabase).mockResolvedValue({} as never);
  vi.mocked(getPublicConfig).mockResolvedValue(createPublicConfig());
  vi.mocked(listPublicCharacters).mockResolvedValue(createCharacters());
});

test("renders the editorial homepage shell with up to three official character portraits", async () => {
  const element = await HomePage();
  render(element);

  expect(screen.getByRole("navigation", { name: "Primary" })).toBeVisible();
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
    /conversations/i,
  );
  expect(screen.getAllByRole("img")).toHaveLength(4);
  expect(screen.getByRole("link", { name: "Get started" })).toHaveAttribute(
    "href",
    "/auth/sign-up",
  );
  expect(
    screen.getByRole("link", { name: "Browse characters" }),
  ).toHaveAttribute("href", "/characters");
  expect(listPublicCharacters).toHaveBeenCalledWith({});
});

test("points the primary action to sign in when registration is closed", async () => {
  vi.mocked(getPublicConfig).mockResolvedValue(createPublicConfig(false));

  const element = await HomePage();
  render(element);

  expect(screen.getByRole("link", { name: "Get started" })).toHaveAttribute(
    "href",
    "/auth/sign-in",
  );
});

test("renders an intentional empty character stage without fake portraits", async () => {
  vi.mocked(listPublicCharacters).mockResolvedValue([]);

  const element = await HomePage();
  render(element);

  expect(
    screen.getByText(
      /official characters appear here once they are available/i,
    ),
  ).toBeVisible();
  expect(screen.getAllByRole("img")).toHaveLength(1);
});
