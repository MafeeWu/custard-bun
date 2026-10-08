import { createHash } from "node:crypto";
import {
  characterContentSchema,
  type CharacterContent,
  type CharacterFieldGroup,
} from "./character-content";

const characterFieldOrder = [
  "displayName",
  "avatarPath",
  "shortDescription",
  "longDescription",
  "personalityPrinciples",
  "speakingStyle",
  "responseRhythm",
  "relationshipBoundaries",
  "openingMessage",
  "exampleConversations",
  "generationParameters",
  "safetyAdditions",
] as const satisfies readonly CharacterFieldGroup[];

type CanonicalValue =
  | string
  | number
  | boolean
  | null
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

function canonicalizeValue(value: unknown): CanonicalValue {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeValue(item));
  }

  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([left], [right]) => left.localeCompare(right),
    );

    return entries.reduce<Record<string, CanonicalValue>>(
      (accumulator, [key, nestedValue]) => {
        accumulator[key] = canonicalizeValue(nestedValue);
        return accumulator;
      },
      {},
    );
  }

  return value as CanonicalValue;
}

function canonicalCharacterContent(content: CharacterContent): Record<
  CharacterFieldGroup,
  CanonicalValue
> {
  return characterFieldOrder.reduce(
    (accumulator, key) => {
      accumulator[key] = canonicalizeValue(content[key]);
      return accumulator;
    },
    {} as Record<CharacterFieldGroup, CanonicalValue>,
  );
}

export function characterContentDigest(content: CharacterContent): string {
  const parsed = characterContentSchema.parse(content);

  return createHash("sha256")
    .update(JSON.stringify(canonicalCharacterContent(parsed)))
    .digest("hex");
}

export function changedCharacterFieldGroups(
  previous: CharacterContent,
  next: CharacterContent,
): CharacterFieldGroup[] {
  const previousContent = canonicalCharacterContent(
    characterContentSchema.parse(previous),
  );
  const nextContent = canonicalCharacterContent(characterContentSchema.parse(next));

  return characterFieldOrder.filter(
    (key) =>
      JSON.stringify(previousContent[key]) !== JSON.stringify(nextContent[key]),
  );
}
