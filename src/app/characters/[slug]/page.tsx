import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { startConversationAction } from "@/app/app/conversations/actions";
import { StartConversationForm } from "@/components/chat/chat-screen";
import { CharacterProfile } from "@/components/characters/character-profile";
import { getAuth } from "@/server/auth/auth";
import { listActiveConversations } from "@/server/chat/conversation-queries";
import { getPublicCharacterBySlug } from "@/server/characters/character-queries";
import { getDatabase } from "@/server/db/database";

export const dynamic = "force-dynamic";

interface CharacterDetailPageProps {
  params: Promise<{ slug: string }>;
}

export default async function CharacterDetailPage({
  params,
}: CharacterDetailPageProps) {
  const { slug } = await params;
  const database = await getDatabase();
  const character = await getPublicCharacterBySlug(database, slug);

  if (!character) {
    notFound();
  }

  const requestHeaders = await headers();
  const auth = await getAuth();
  const session = await auth.api.getSession({
    headers: requestHeaders,
    query: { disableCookieCache: true },
  });
  const signedIn = session && session.user.banned !== true;
  const activeConversation = signedIn
    ? (await listActiveConversations(database, session.user.id)).find(
        (candidate) => candidate.character.id === character.id,
      )
    : undefined;

  return (
    <main className="page-shell page-stack">
      <CharacterProfile character={character} />
      {signedIn ? (
        <StartConversationForm
          action={startConversationAction.bind(
            null,
            character.id,
            character.slug,
          )}
          label={
            activeConversation
              ? "Continue conversation"
              : "Start conversation"
          }
        />
      ) : (
        <a
          className="brand-primary"
          href={`/auth/sign-in?returnTo=${encodeURIComponent(
            `/characters/${character.slug}`,
          )}`}
        >
          Sign in to start a conversation
        </a>
      )}
    </main>
  );
}
