// @vitest-environment node
import { describe, expect, test } from "vitest";
import {
  contrastRatio,
  createBrandThemeVariables,
} from "@/server/branding/accent-theme";

const LIGHT_SURFACE = "#F8FAFC";
const DARK_SURFACE = "#0F172A";

describe("createBrandThemeVariables", () => {
  test.each(["#FFFFFF", "#000000", "#F59E0B", "#1757D5", "#7F8C8D"])(
    "derives readable accent variables from %s",
    (accent) => {
      const theme = createBrandThemeVariables(accent);

      expect(theme["--color-accent"]).toBe(accent.toUpperCase());
      expect(
        contrastRatio(
          theme["--color-accent-contrast"],
          theme["--color-accent"],
        ),
      ).toBeGreaterThanOrEqual(4.5);
      expect(theme["--color-focus"]).not.toBe(theme["--color-accent-soft"]);
    },
  );

  test.each(["#FFFFFF", "#000000", "#F59E0B", "#1757D5", "#7F8C8D"])(
    "derives readable accent-soft surface text from %s",
    (accent) => {
      const theme = createBrandThemeVariables(accent) as Record<string, string>;

      expect(theme).toHaveProperty("--color-accent-soft-contrast");
      expect(
        contrastRatio(
          theme["--color-accent-soft-contrast"],
          theme["--color-accent-soft"],
        ),
      ).toBeGreaterThanOrEqual(4.5);
    },
  );

  test.each(["#FFFFFF", "#05070B", "#1757D5", "#7F8C8D"])(
    "keeps focus visible for %s on light and dark surfaces",
    (accent) => {
      const theme = createBrandThemeVariables(accent);

      expect(
        contrastRatio(theme["--color-focus"], LIGHT_SURFACE),
        "light surface",
      ).toBeGreaterThanOrEqual(3);
      expect(
        contrastRatio(theme["--color-focus"], DARK_SURFACE),
        "dark surface",
      ).toBeGreaterThanOrEqual(3);
    },
  );

  test.each(["orange", "#FFF", "#GG0000", "rgb(1 2 3)"])(
    "rejects unsupported primary color %s",
    (accent) => {
      expect(() => createBrandThemeVariables(accent)).toThrow(
        "Brand primary color must be a six-digit hex color",
      );
    },
  );
});
