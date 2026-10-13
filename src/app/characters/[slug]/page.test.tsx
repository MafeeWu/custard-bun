import { render, screen } from "@testing-library/react";
import { notFound } from "next/navigation";
import { expect, test, vi } from "vitest";
import { getPublicCharacterBySlug } from "@/server/characters/character-queries";
import { listActiveConversations } from "@/server/chat/conversation-queries";
import { getPublicConfig } from "@/server/config/public-config";
import type { PublicAppConfig } from "@/server/config/schema";
import { getDatabase } from "@/server/db/database";
import CharacterDetailPage, { dynamic } from "./page";

vi.mock("@/server/db/database", () => ({
  getDatabase: vi.fn(),
}));

vi.mock("@/server/characters/character-queries", () => ({
  getPublicCharacterBySlug: vi.fn(),
}));

vi.mock("@/server/chat/conversation-queries", () => ({
  listActiveConversations: vi.fn(),
}));

vi.mock("@/server/config/public-config", () => ({
  getPublicConfig: vi.fn(),
}));

vi.mock("@/server/auth/auth", () => ({
  getAuth: vi.fn(async () => ({
    api: { getSession: vi.fn(async () => null) },
  })),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
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

const character = {
  id: "11111111-1111-1111-1111-111111111111",
  slug: "calm-companion",
  displayName: "Calm Companion",
  avatarPath: "/characters/calm-listener.svg",
  shortDescription: "A calm, grounded presence.",
  longDescription: "A patient character for careful reflection.",
  personalityPrinciples: ["Lead with reflection."],
  speakingStyle: "Calm and warm.",
  responseRhythm: "Starts slow and asks one question.",
  relationshipBoundaries: ["Never pretend to be human."],
  openingMessage: "What feels most important right now?",
};

test("is force-dynamic and keeps anonymous sign-in actions on the same encoded return path", async () => {
  vi.mocked(getPublicConfig).mockResolvedValue(createPublicConfig());
  vi.mocked(getDatabase).mockResolvedValue({} as never);
  vi.mocked(getPublicCharacterBySlug).mockResolvedValue(character);

  const element = await CharacterDetailPage({
    params: Promise.resolve({ slug: "calm-companion" }),
  });
  render(element);

  expect(dynamic).toBe("force-dynamic");
  expect(
    screen.getByRole("heading", { level: 1, name: "Calm Companion" }),
  ).toBeVisible();
  const expectedHref = "/auth/sign-in?returnTo=%2Fcharacters%2Fcalm-companion";

  expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
    "href",
    expectedHref,
  );
  expect(
    screen.getByRole("link", { name: "Sign in to start a conversation" }),
  ).toHaveAttribute("href", expectedHref);
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
});

test.each([
  [[], "Start conversation"],
  [
    [
      {
        id: "conversation-1",
        character: {
          id: character.id,
          slug: character.slug,
          displayName: character.displayName,
          avatarPath: character.avatarPath,
          pinnedVersionId: "version-1",
          isCurrentDefault: true,
        },
        lastMessageAt: new Date(),
      },
    ],
    "Continue conversation",
  ],
] as const)("shows %s for a signed-in visitor", async (active, label) => {
  const { getAuth } = await import("@/server/auth/auth");
  vi.mocked(getAuth).mockResolvedValue({
    api: {
      getSession: vi.fn(async () => ({ user: { id: "user-1" } })),
    },
  } as never);
  vi.mocked(getPublicConfig).mockResolvedValue(createPublicConfig());
  vi.mocked(getDatabase).mockResolvedValue({} as never);
  vi.mocked(getPublicCharacterBySlug).mockResolvedValue(character);
  vi.mocked(listActiveConversations).mockResolvedValue([...active]);

  render(
    await CharacterDetailPage({
      params: Promise.resolve({ slug: "calm-companion" }),
    }),
  );

  expect(screen.getByRole("button", { name: label })).toBeVisible();
});

test("calls notFound when the public character does not exist", async () => {
  vi.mocked(getPublicConfig).mockResolvedValue(createPublicConfig());
  vi.mocked(getDatabase).mockResolvedValue({} as never);
  vi.mocked(getPublicCharacterBySlug).mockResolvedValue(null);

  await expect(
    CharacterDetailPage({
      params: Promise.resolve({ slug: "missing-character" }),
    }),
  ).rejects.toThrow("NEXT_NOT_FOUND");

  expect(notFound).toHaveBeenCalledOnce();
});
