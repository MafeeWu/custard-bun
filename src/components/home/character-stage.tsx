import { Avatar } from "@/components/ui/avatar";
import { Surface } from "@/components/ui/surface";
import type { PublicCharacterSummary } from "@/server/characters/character-queries";
import { isRepositoryOwnedCharacterAvatarPath } from "@/server/characters/character-content";

export function CharacterStage({
  characters,
}: {
  characters: readonly PublicCharacterSummary[];
}) {
  if (characters.length === 0) {
    return (
      <Surface
        className="home-stage home-stage--empty"
        padding="lg"
        tone="subtle"
      >
        <p className="home-stage__eyebrow">Official character previews</p>
        <h2 className="home-stage__title">Ready for real characters</h2>
        <p className="home-stage__summary">
          Official characters appear here once they are available.
        </p>
        <div aria-hidden="true" className="home-stage__placeholder">
          <span className="home-stage__placeholder-orbit home-stage__placeholder-orbit--large" />
          <span className="home-stage__placeholder-orbit home-stage__placeholder-orbit--small" />
        </div>
      </Surface>
    );
  }

  return (
    <Surface className="home-stage" padding="lg" tone="raised">
      <div className="home-stage__header">
        <p className="home-stage__eyebrow">Official character previews</p>
        <p className="home-stage__summary">
          Real repository-owned portraits, shaped into one deliberate stage.
        </p>
      </div>
      <div className="home-stage__portraits">
        {characters.map((character, index) => {
          const avatarPath = isRepositoryOwnedCharacterAvatarPath(
            character.avatarPath,
          )
            ? character.avatarPath
            : undefined;

          return (
            <figure
              className={`home-stage__portrait home-stage__portrait--${index + 1}`}
              key={character.id}
            >
              <Avatar
                alt={`${character.displayName} portrait`}
                className="home-stage__avatar"
                name={character.displayName}
                size="lg"
                src={avatarPath}
              />
              <figcaption className="home-stage__caption">
                <p className="home-stage__name">{character.displayName}</p>
                <p className="home-stage__line">{character.shortDescription}</p>
              </figcaption>
            </figure>
          );
        })}
      </div>
    </Surface>
  );
}
