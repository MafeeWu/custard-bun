import { CharacterEditor } from "@/components/admin/characters/character-editor";
import type { CharacterContent } from "@/server/characters/character-content";
import { createCharacterAction } from "../actions";

export const dynamic = "force-dynamic";

const blankContent: CharacterContent = {
  displayName: "",
  avatarPath: "",
  shortDescription: "",
  longDescription: "",
  personalityPrinciples: [""],
  speakingStyle: "",
  responseRhythm: "",
  relationshipBoundaries: [""],
  openingMessage: "",
  exampleConversations: [{ user: "", assistant: "" }],
  generationParameters: { temperature: 0.7, topP: 0.9, maxOutputTokens: 700 },
  safetyAdditions: [],
};

export default function NewCharacterPage() {
  return (
    <section className="page-stack">
      <h1>Create official character</h1>
      <CharacterEditor
        mode="create"
        content={blankContent}
        action={createCharacterAction}
      />
    </section>
  );
}
