type RgbColor = [red: number, green: number, blue: number];

export type BrandThemeVariable =
  | "--color-accent"
  | "--color-accent-hover"
  | "--color-accent-active"
  | "--color-accent-soft"
  | "--color-accent-soft-contrast"
  | "--color-accent-border"
  | "--color-accent-contrast"
  | "--color-accent-text-light"
  | "--color-accent-text-dark"
  | "--color-focus";

export type BrandThemeVariables = Record<BrandThemeVariable, string>;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const LIGHT_TEXT = "#FFFFFF";
const DARK_TEXT = "#0B1220";
const LIGHT_TEXT_SURFACE = "#E8F0FE";
const DARK_TEXT_SURFACE = "#203C5E";
const MINIMUM_FOCUS_CONTRAST = 3;
const MINIMUM_TEXT_CONTRAST = 4.5;

export function createBrandThemeVariables(
  primaryColor: string,
): BrandThemeVariables {
  if (!HEX_COLOR.test(primaryColor)) {
    throw new Error("Brand primary color must be a six-digit hex color");
  }

  const accent = primaryColor.toUpperCase();
  const accentSoft = mixHex(accent, LIGHT_TEXT, 0.86);
  const foreground = deriveReadableTextColor(accent);

  return {
    "--color-accent": accent,
    "--color-accent-hover": deriveInteractionColor(accent, foreground, 0.12),
    "--color-accent-active": deriveInteractionColor(accent, foreground, 0.2),
    "--color-accent-soft": accentSoft,
    "--color-accent-soft-contrast": deriveReadableTextColor(accentSoft),
    "--color-accent-border": mixHex(accent, LIGHT_TEXT, 0.62),
    "--color-accent-contrast": foreground,
    "--color-accent-text-light": deriveSurfaceTextColor(
      accent,
      LIGHT_TEXT_SURFACE,
      DARK_TEXT,
    ),
    "--color-accent-text-dark": deriveSurfaceTextColor(
      accent,
      DARK_TEXT_SURFACE,
      LIGHT_TEXT,
    ),
    "--color-focus": deriveFocusColor(accent),
  };
}

export function contrastRatio(foreground: string, background: string): number {
  const lighter = relativeLuminance(parseHexColor(foreground));
  const darker = relativeLuminance(parseHexColor(background));
  const high = Math.max(lighter, darker);
  const low = Math.min(lighter, darker);

  return (high + 0.05) / (low + 0.05);
}

function deriveFocusColor(accent: string): string {
  const candidates = Array.from(
    new Set(
      Array.from({ length: 256 }, (_, step) => step / 255).flatMap((amount) => [
        mixHex(accent, DARK_TEXT, amount),
        mixHex(accent, LIGHT_TEXT, amount),
        mixHex("#000000", LIGHT_TEXT, amount),
      ]),
    ),
  );

  const scored = candidates.map((color) => {
    const lightContrast = contrastRatio(color, LIGHT_TEXT_SURFACE);
    const darkContrast = contrastRatio(color, DARK_TEXT_SURFACE);

    return {
      color,
      lightContrast,
      darkContrast,
      minimumContrast: Math.min(lightContrast, darkContrast),
      distance: colorDistance(accent, color),
    };
  });

  const visibleCandidate = scored
    .filter(
      ({ lightContrast, darkContrast }) =>
        lightContrast >= MINIMUM_FOCUS_CONTRAST &&
        darkContrast >= MINIMUM_FOCUS_CONTRAST,
    )
    .sort(
      (left, right) =>
        left.distance - right.distance ||
        right.minimumContrast - left.minimumContrast,
    )[0];

  if (visibleCandidate) {
    return visibleCandidate.color;
  }

  throw new Error("No readable focus color for the semantic surfaces");
}

function deriveReadableTextColor(background: string): string {
  const preferred =
    contrastRatio(DARK_TEXT, background) >=
    contrastRatio(LIGHT_TEXT, background)
      ? DARK_TEXT
      : LIGHT_TEXT;
  return contrastRatio(preferred, background) >= MINIMUM_TEXT_CONTRAST
    ? preferred
    : "#000000";
}

function deriveInteractionColor(
  accent: string,
  foreground: string,
  amount: number,
): string {
  for (
    let percentage = Math.round(amount * 100);
    percentage >= 0;
    percentage--
  ) {
    const candidate = mixHex(accent, foreground, percentage / 100);
    if (contrastRatio(foreground, candidate) >= MINIMUM_TEXT_CONTRAST)
      return candidate;
  }
  return accent;
}

function deriveSurfaceTextColor(
  accent: string,
  surface: string,
  target: string,
): string {
  for (let percentage = 0; percentage <= 100; percentage += 1) {
    const candidate = mixHex(accent, target, percentage / 100);
    if (contrastRatio(candidate, surface) >= MINIMUM_TEXT_CONTRAST) {
      return candidate;
    }
  }

  return target;
}

function mixHex(base: string, target: string, amount: number): string {
  const source = parseHexColor(base);
  const destination = parseHexColor(target);
  const mixed = source.map((channel, index) =>
    Math.round(channel + (destination[index]! - channel) * amount),
  ) as RgbColor;

  return toHexColor(mixed);
}

function colorDistance(first: string, second: string): number {
  const [redA, greenA, blueA] = parseHexColor(first);
  const [redB, greenB, blueB] = parseHexColor(second);

  return (redA - redB) ** 2 + (greenA - greenB) ** 2 + (blueA - blueB) ** 2;
}

function parseHexColor(color: string): RgbColor {
  if (!HEX_COLOR.test(color)) {
    throw new Error("Color must be a six-digit hex color");
  }

  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
  ];
}

function toHexColor([red, green, blue]: RgbColor): string {
  return `#${[red, green, blue]
    .map((channel) => channel.toString(16).padStart(2, "0").toUpperCase())
    .join("")}`;
}

function relativeLuminance(color: RgbColor): number {
  const [red, green, blue] = color.map((channel) => toLinear(channel / 255));

  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function toLinear(channel: number): number {
  if (channel <= 0.04045) {
    return channel / 12.92;
  }

  return ((channel + 0.055) / 1.055) ** 2.4;
}
