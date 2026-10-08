import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { getDatabase } from "@/server/db/database";
import { listPublicCharacters } from "@/server/characters/character-queries";
import CharactersCatalogPage, { dynamic } from "./page";

vi.mock("@/server/db/database", () => ({
  getDatabase: vi.fn(),
}));

vi.mock("@/server/characters/character-queries", () => ({
  listPublicCharacters: vi.fn(),
}));

test("is force-dynamic and renders empty catalog copy", async () => {
  vi.mocked(getDatabase).mockResolvedValue({} as never);
  vi.mocked(listPublicCharacters).mockResolvedValue([]);

  const element = await CharactersCatalogPage();
  render(element);

  expect(dynamic).toBe("force-dynamic");
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
    "Browse characters",
  );
  expect(screen.getByText(/no official characters are available/i)).toBeVisible();
  expect(listPublicCharacters).toHaveBeenCalledWith({});
});

test("renders character cards from the public catalog query", async () => {
  vi.mocked(getDatabase).mockResolvedValue({} as never);
  vi.mocked(listPublicCharacters).mockResolvedValue([
    {
      id: "11111111-1111-1111-1111-111111111111",
      slug: "calm-companion",
      displayName: "Calm Companion",
      avatarPath: "/characters/calm-listener.svg",
      shortDescription: "A calm, grounded presence.",
      openingMessage: "What feels most important right now?",
    },
  ]);

  const element = await CharactersCatalogPage();
  render(element);

  expect(
    screen.getByRole("link", { name: /calm companion/i }),
  ).toHaveAttribute("href", "/characters/calm-companion");
});
