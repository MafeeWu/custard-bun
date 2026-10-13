import { type ReactNode } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Surface } from "@/components/ui/surface";
import { isRepositoryOwnedCharacterAvatarPath } from "@/server/characters/character-content";
import type { PublicCharacterDetail } from "@/server/characters/character-queries";

export function CharacterProfile({
  action,
  character,
}: {
  action?: ReactNode;
  character: PublicCharacterDetail;
}) {
  const avatarPath = isRepositoryOwnedCharacterAvatarPath(character.avatarPath)
    ? character.avatarPath
    : undefined;

  return (
    <article className="character-profile">
      <header className="character-profile__hero">
        <Surface
          as="section"
          className="character-profile__portrait-frame"
          padding="sm"
          tone="subtle"
        >
          <Avatar
            alt={`${character.displayName} avatar`}
            className="character-profile__avatar"
            height={208}
            name={character.displayName}
            size="lg"
            src={avatarPath}
            width={208}
          />
        </Surface>
        <div className="character-profile__identity">
          <p className="character-eyebrow">Official character</p>
          <h1>{character.displayName}</h1>
          <p className="character-summary">{character.shortDescription}</p>
          <p className="character-profile__description">
            {character.longDescription}
          </p>
          {action ? (
            <div className="character-profile__action">{action}</div>
          ) : null}
        </div>
      </header>

      <Surface
        as="section"
        className="character-profile__opening-surface"
        padding="lg"
        tone="accent"
      >
        <p className="character-profile__section-eyebrow">Opening voice</p>
        <blockquote className="character-opening">
          <p>“{character.openingMessage}”</p>
        </blockquote>
      </Surface>

      <div className="character-detail-grid">
        <Surface as="section" className="character-detail-section" padding="lg">
          <p className="character-detail-section__eyebrow">Personality</p>
          <h2>Personality principles</h2>
          <ul>
            {character.personalityPrinciples.map((principle) => (
              <li key={principle}>{principle}</li>
            ))}
          </ul>
        </Surface>

        <Surface as="section" className="character-detail-section" padding="lg">
          <p className="character-detail-section__eyebrow">Communication</p>
          <h2>Speaking style</h2>
          <p>{character.speakingStyle}</p>
        </Surface>

        <Surface as="section" className="character-detail-section" padding="lg">
          <p className="character-detail-section__eyebrow">Pacing</p>
          <h2>Response rhythm</h2>
          <p>{character.responseRhythm}</p>
        </Surface>

        <Surface as="section" className="character-detail-section" padding="lg">
          <p className="character-detail-section__eyebrow">Boundaries</p>
          <h2>Relationship boundaries</h2>
          <ul>
            {character.relationshipBoundaries.map((boundary) => (
              <li key={boundary}>{boundary}</li>
            ))}
          </ul>
        </Surface>
      </div>
    </article>
  );
}
