type RgbColor = [red: number, green: number, blue: number];

export type BrandThemeVariable =
  | "--color-accent"
  | "--color-accent-hover"
  | "--color-accent-active"
  | "--color-accent-soft"
  | "--color-accent-soft-contrast"
  | "--color-accent-border"
  | "--color-accent-contrast"
  | "--color-focus";

export type BrandThemeVariables = Record<BrandThemeVariable, string>;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const LIGHT_TEXT = "#FFFFFF";
const DARK_TEXT = "#0B1220";
const LIGHT_FOCUS_SURFACE = "#F8FAFC";
const DARK_FOCUS_SURFACE = "#0F172A";
const MINIMUM_FOCUS_CONTRAST = 3;
const FOCUS_MIX_STEPS = [
  0, 0.08, 0.12, 0.16, 0.2, 0.24, 0.28, 0.32, 0.36, 0.44, 0.52, 0.6, 0.68, 0.76,
] as const;

export function createBrandThemeVariables(
  primaryColor: string,
): BrandThemeVariables {
  if (!HEX_COLOR.test(primaryColor)) {
    throw new Error("Brand primary color must be a six-digit hex color");
  }

  const accent = primaryColor.toUpperCase();
  const accentSoft = mixHex(accent, LIGHT_TEXT, 0.86);

  return {
    "--color-accent": accent,
    "--color-accent-hover": mixHex(
      accent,
      deriveReadableTextColor(accent),
      0.12,
    ),
    "--color-accent-active": mixHex(
      accent,
      deriveReadableTextColor(accent),
      0.2,
    ),
    "--color-accent-soft": accentSoft,
    "--color-accent-soft-contrast": deriveReadableTextColor(accentSoft),
    "--color-accent-border": mixHex(accent, LIGHT_TEXT, 0.62),
    "--color-accent-contrast": deriveReadableTextColor(accent),
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
      FOCUS_MIX_STEPS.flatMap((amount) => [
        mixHex(accent, DARK_TEXT, amount),
        mixHex(accent, LIGHT_TEXT, amount),
      ]),
    ),
  );

  const scored = candidates.map((color) => {
    const lightContrast = contrastRatio(color, LIGHT_FOCUS_SURFACE);
    const darkContrast = contrastRatio(color, DARK_FOCUS_SURFACE);

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

  return scored.sort(
    (left, right) =>
      right.minimumContrast - left.minimumContrast ||
      left.distance - right.distance,
  )[0]!.color;
}

function deriveReadableTextColor(background: string): string {
  return contrastRatio(DARK_TEXT, background) >=
    contrastRatio(LIGHT_TEXT, background)
    ? DARK_TEXT
    : LIGHT_TEXT;
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
