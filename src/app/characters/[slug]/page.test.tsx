import { render, screen } from "@testing-library/react";
import { notFound } from "next/navigation";
import { expect, test, vi } from "vitest";
import { getPublicCharacterBySlug } from "@/server/characters/character-queries";
import { getDatabase } from "@/server/db/database";
import CharacterDetailPage, { dynamic } from "./page";

vi.mock("@/server/db/database", () => ({
  getDatabase: vi.fn(),
}));

vi.mock("@/server/characters/character-queries", () => ({
  getPublicCharacterBySlug: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

test("is force-dynamic and renders the public profile without chat controls", async () => {
  vi.mocked(getDatabase).mockResolvedValue({} as never);
  vi.mocked(getPublicCharacterBySlug).mockResolvedValue({
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
  });

  const element = await CharacterDetailPage({
    params: Promise.resolve({ slug: "calm-companion" }),
  });
  render(element);

  expect(dynamic).toBe("force-dynamic");
  expect(
    screen.getByRole("heading", { level: 1, name: "Calm Companion" }),
  ).toBeVisible();
  expect(screen.queryByRole("button", { name: /chat/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
});

test("calls notFound when the public character does not exist", async () => {
  vi.mocked(getDatabase).mockResolvedValue({} as never);
  vi.mocked(getPublicCharacterBySlug).mockResolvedValue(null);

  await expect(
    CharacterDetailPage({
      params: Promise.resolve({ slug: "missing-character" }),
    }),
  ).rejects.toThrow("NEXT_NOT_FOUND");

  expect(notFound).toHaveBeenCalledOnce();
});
