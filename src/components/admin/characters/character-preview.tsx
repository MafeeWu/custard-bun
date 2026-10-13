import { CharacterCard } from "@/components/characters/character-card";
import { CharacterProfile } from "@/components/characters/character-profile";
import { AdminSection } from "@/components/admin/admin-section";
import type { AdminCharacterPreview } from "@/server/characters/character-queries";

export function CharacterPreview({
  character,
}: {
  character: AdminCharacterPreview;
}) {
  const summary = {
    id: character.id,
    slug: character.slug,
    displayName: character.draft.displayName,
    avatarPath: character.draft.avatarPath,
    shortDescription: character.draft.shortDescription,
    openingMessage: character.draft.openingMessage,
  };
  const detail = {
    ...summary,
    longDescription: character.draft.longDescription,
    personalityPrinciples: character.draft.personalityPrinciples,
    speakingStyle: character.draft.speakingStyle,
    responseRhythm: character.draft.responseRhythm,
    relationshipBoundaries: character.draft.relationshipBoundaries,
  };

  return (
    <section className="admin-preview page-stack">
      <p className="admin-helper-text">
        Draft revision {character.draftRevision}
      </p>
      <CharacterCard character={summary} />
      <CharacterProfile character={detail} />

      <AdminSection title="Structured character package">
        <section>
          <h3>Example conversations</h3>
          {character.draft.exampleConversations.map((example, index) => (
            <dl key={`${example.user}-${index}`}>
              <dt>User</dt>
              <dd>{example.user}</dd>
              <dt>Assistant</dt>
              <dd>{example.assistant}</dd>
            </dl>
          ))}
        </section>
        <section>
          <h3>Generation parameters</h3>
          <ul>
            <li>
              temperature: {character.draft.generationParameters.temperature}
            </li>
            <li>topP: {character.draft.generationParameters.topP}</li>
            <li>
              maxOutputTokens:{" "}
              {character.draft.generationParameters.maxOutputTokens}
            </li>
          </ul>
        </section>
        <section>
          <h3>Safety additions</h3>
          <ul>
            {character.draft.safetyAdditions.map((addition) => (
              <li key={addition}>{addition}</li>
            ))}
          </ul>
        </section>
      </AdminSection>
    </section>
  );
}
