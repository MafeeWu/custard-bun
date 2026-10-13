import { render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { getPublicConfig } from "@/server/config/public-config";
import type { PublicAppConfig } from "@/server/config/schema";
import { getDatabase } from "@/server/db/database";
import { listPublicCharacters } from "@/server/characters/character-queries";
import CharactersCatalogPage, { dynamic } from "./page";

vi.mock("@/server/config/public-config", () => ({
  getPublicConfig: vi.fn(),
}));

vi.mock("@/server/db/database", () => ({
  getDatabase: vi.fn(),
}));

vi.mock("@/server/characters/character-queries", () => ({
  listPublicCharacters: vi.fn(),
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

test("is force-dynamic and renders the catalog empty state inside EmptyState", async () => {
  vi.mocked(getPublicConfig).mockResolvedValue(createPublicConfig());
  vi.mocked(getDatabase).mockResolvedValue({} as never);
  vi.mocked(listPublicCharacters).mockResolvedValue([]);

  const element = await CharactersCatalogPage();
  render(element);

  expect(dynamic).toBe("force-dynamic");
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
    "Browse characters",
  );
  expect(
    screen.getByText(
      /meet the official companions available for new conversations across this app\./i,
    ),
  ).toBeVisible();
  const emptyStateTitle = screen.getByRole("heading", {
    level: 2,
    name: "No official characters are available right now",
  });
  expect(emptyStateTitle.closest("section")).toHaveClass("ui-empty-state");
  expect(listPublicCharacters).toHaveBeenCalledWith({});
});

test("features only the first stable card when enough characters exist and keeps every card a visible link", async () => {
  vi.mocked(getPublicConfig).mockResolvedValue(createPublicConfig());
  vi.mocked(getDatabase).mockResolvedValue({} as never);
  vi.mocked(listPublicCharacters).mockResolvedValue([
    {
      id: "11111111-1111-1111-1111-111111111111",
      slug: "calm-listener",
      displayName: "Calm Listener",
      avatarPath: "/characters/calm-listener.svg",
      shortDescription: "A calm, grounded presence.",
      openingMessage:
        "What feels most important right now, and where would it help to move more slowly than usual?",
    },
    {
      id: "22222222-2222-2222-2222-222222222222",
      slug: "steady-orbit",
      displayName: "Steady Orbit",
      avatarPath: "/characters/steady-orbit.svg",
      shortDescription: "A thoughtful partner for continuity.",
      openingMessage: "We can pick back up without losing the thread.",
    },
    {
      id: "33333333-3333-3333-3333-333333333333",
      slug: "river-lantern",
      displayName: "River Lantern",
      avatarPath: "/characters/river-lantern.svg",
      shortDescription: "A steady guide for clearer next steps.",
      openingMessage: "Tell me what still needs shape before we move ahead.",
    },
  ]);

  const element = await CharactersCatalogPage();
  render(element);

  const list = screen.getByRole("list", { name: "Official characters" });
  const links = within(list).getAllByRole("link");

  expect(links).toHaveLength(3);
  expect(
    within(list).getByRole("link", { name: /calm listener/i }),
  ).toHaveAttribute("href", "/characters/calm-listener");
  expect(links[0]).toHaveAttribute("data-emphasis", "featured");
  expect(links[1]).toHaveAttribute("data-emphasis", "standard");
  expect(links[2]).toHaveAttribute("data-emphasis", "standard");
  expect(
    within(list).getByText(
      /what feels most important right now, and where would it help to move more slowly than usual\?/i,
    ),
  ).toBeVisible();
});

test("keeps every card standard when fewer than three public characters are available", async () => {
  vi.mocked(getPublicConfig).mockResolvedValue(createPublicConfig());
  vi.mocked(getDatabase).mockResolvedValue({} as never);
  vi.mocked(listPublicCharacters).mockResolvedValue([
    {
      id: "11111111-1111-1111-1111-111111111111",
      slug: "calm-listener",
      displayName: "Calm Listener",
      avatarPath: "/characters/calm-listener.svg",
      shortDescription: "A calm, grounded presence.",
      openingMessage: "What feels most important right now?",
    },
    {
      id: "22222222-2222-2222-2222-222222222222",
      slug: "steady-orbit",
      displayName: "Steady Orbit",
      avatarPath: "/characters/steady-orbit.svg",
      shortDescription: "A thoughtful partner for continuity.",
      openingMessage: "We can pick back up without losing the thread.",
    },
  ]);

  render(await CharactersCatalogPage());

  const links = within(
    screen.getByRole("list", { name: "Official characters" }),
  ).getAllByRole("link");

  expect(links).toHaveLength(2);
  for (const link of links) {
    expect(link).toHaveAttribute("data-emphasis", "standard");
  }
});
