import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { characterContentSchema } from "./character-content";
import { OFFICIAL_CHARACTER_SEEDS } from "./seed-definitions";

const stableIds = [
  "2af34f55-f24e-4b1d-b651-5ee52e06b31c",
  "5768ba76-7e7e-4820-a6b2-a4d4a0960663",
  "7ea46f9d-b734-40cb-ae57-24f9311d206d",
  "9a69137b-40b3-4814-bb7f-983e34f9c7f2",
  "c7eeeb5e-5f43-4747-88a1-f58472313306",
];

function expectUnique(values: readonly string[]) {
  expect(new Set(values).size).toBe(values.length);
}

describe("OFFICIAL_CHARACTER_SEEDS", () => {
  test("defines exactly five stable official characters with unique identities", () => {
    expect(OFFICIAL_CHARACTER_SEEDS.map((seed) => seed.id)).toEqual(stableIds);
    expect(OFFICIAL_CHARACTER_SEEDS.map((seed) => seed.slug)).toEqual([
      "calm-listener",
      "energetic-friend",
      "rational-companion",
      "creative-storyteller",
      "action-coach",
    ]);

    expectUnique(OFFICIAL_CHARACTER_SEEDS.map((seed) => seed.id));
    expectUnique(OFFICIAL_CHARACTER_SEEDS.map((seed) => seed.slug));
    expectUnique(
      OFFICIAL_CHARACTER_SEEDS.map((seed) => seed.content.avatarPath),
    );
  });

  test("ships schema-valid production content for every official character", () => {
    for (const seed of OFFICIAL_CHARACTER_SEEDS) {
      expect(() => characterContentSchema.parse(seed.content)).not.toThrow();
    }
  });

  test("keeps core behavior fields distinct between every character pair", () => {
    for (const [index, seed] of OFFICIAL_CHARACTER_SEEDS.entries()) {
      for (const other of OFFICIAL_CHARACTER_SEEDS.slice(index + 1)) {
        expect(seed.content.personalityPrinciples).not.toEqual(
          other.content.personalityPrinciples,
        );
        expect(seed.content.openingMessage).not.toBe(
          other.content.openingMessage,
        );
        expect(seed.content.exampleConversations).not.toEqual(
          other.content.exampleConversations,
        );
        expect(seed.content.responseRhythm).not.toBe(
          other.content.responseRhythm,
        );
      }
    }
  });

  test("references local script-free SVG avatars with accessible titles", async () => {
    for (const seed of OFFICIAL_CHARACTER_SEEDS) {
      expect(seed.content.avatarPath).toMatch(/^\/characters\/[a-z-]+\.svg$/);
      const svg = await readFile(
        path.join(process.cwd(), "public", seed.content.avatarPath),
        "utf8",
      );

      expect(svg).toMatch(/<title>[^<]+<\/title>/);
      expect(svg).not.toMatch(
        /<script|\bon\w+=|href=["']https?:|data:image|<image|<text/i,
      );
      expect(svg).not.toMatch(/font-family|@font-face/i);
    }
  });
});
