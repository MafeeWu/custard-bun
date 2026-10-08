import type { PublicCharacterDetail } from "@/server/characters/character-queries";

export function CharacterProfile({
  character,
}: {
  character: PublicCharacterDetail;
}) {
  return (
    <article className="character-profile">
      <header className="character-profile-header">
        <img
          className="character-profile-avatar"
          src={character.avatarPath}
          alt={`${character.displayName} avatar`}
          width={144}
          height={144}
        />
        <div className="character-profile-copy">
          <p className="character-eyebrow">Official character</p>
          <h1>{character.displayName}</h1>
          <p className="character-summary">{character.shortDescription}</p>
          <p>{character.longDescription}</p>
          <blockquote className="character-opening">
            <p>“{character.openingMessage}”</p>
          </blockquote>
        </div>
      </header>

      <div className="character-detail-grid">
        <section className="character-detail-section">
          <h2>Personality principles</h2>
          <ul>
            {character.personalityPrinciples.map((principle) => (
              <li key={principle}>{principle}</li>
            ))}
          </ul>
        </section>

        <section className="character-detail-section">
          <h2>Speaking style</h2>
          <p>{character.speakingStyle}</p>
        </section>

        <section className="character-detail-section">
          <h2>Response rhythm</h2>
          <p>{character.responseRhythm}</p>
        </section>

        <section className="character-detail-section">
          <h2>Relationship boundaries</h2>
          <ul>
            {character.relationshipBoundaries.map((boundary) => (
              <li key={boundary}>{boundary}</li>
            ))}
          </ul>
        </section>
      </div>
    </article>
  );
}
