import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { Surface } from "@/components/ui/surface";
import { isRepositoryOwnedCharacterAvatarPath } from "@/server/characters/character-content";
import type { PublicCharacterSummary } from "@/server/characters/character-queries";
import { cx } from "@/components/ui/cx";

export interface CharacterCardProps {
  character: PublicCharacterSummary;
  emphasis?: "featured" | "standard";
  index?: number;
}

export function CharacterCard({
  character,
  emphasis = "standard",
  index,
}: CharacterCardProps) {
  const avatarPath = isRepositoryOwnedCharacterAvatarPath(character.avatarPath)
    ? character.avatarPath
    : undefined;
  const eyebrow =
    emphasis === "featured"
      ? "Featured opening voice"
      : index !== undefined
        ? `Character ${index + 1}`
        : "Official character";
  const headingId = `character-${character.slug}-title`;

  return (
    <Link
      aria-labelledby={headingId}
      data-emphasis={emphasis}
      href={`/characters/${character.slug}`}
      className={cx(
        "character-card-link",
        emphasis === "featured"
          ? "character-card-link--featured"
          : "character-card-link--standard",
      )}
    >
      <Surface
        as="article"
        className={cx(
          "character-card",
          emphasis === "featured"
            ? "character-card--featured"
            : "character-card--standard",
        )}
        padding={emphasis === "featured" ? "lg" : "md"}
        tone={emphasis === "featured" ? "raised" : "default"}
      >
        <div className="character-card__media">
          <Avatar
            alt={`${character.displayName} avatar`}
            className="character-card__avatar"
            height={160}
            name={character.displayName}
            size="lg"
            src={avatarPath}
            width={160}
          />
        </div>
        <div className="character-card__copy">
          <p
            aria-hidden={
              emphasis === "standard" && index !== undefined
                ? true
                : undefined
            }
            className="character-card__eyebrow"
          >
            {eyebrow}
          </p>
          <h2 id={headingId}>{character.displayName}</h2>
          <p className="character-card__summary">
            {character.shortDescription}
          </p>
          <p className="character-card__opening">
            “{character.openingMessage}”
          </p>
        </div>
      </Surface>
    </Link>
  );
}
