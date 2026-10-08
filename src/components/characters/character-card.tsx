import Link from "next/link";
import type { PublicCharacterSummary } from "@/server/characters/character-queries";

export function CharacterCard({
  character,
}: {
  character: PublicCharacterSummary;
}) {
  return (
    <Link
      href={`/characters/${character.slug}`}
      className="character-card-link"
    >
      <article className="character-card">
        <img
          className="character-avatar"
          src={character.avatarPath}
          alt={`${character.displayName} avatar`}
          width={96}
          height={96}
        />
        <div className="character-card-copy">
          <h2>{character.displayName}</h2>
          <p>{character.shortDescription}</p>
          <p className="character-opening">“{character.openingMessage}”</p>
        </div>
      </article>
    </Link>
  );
}
