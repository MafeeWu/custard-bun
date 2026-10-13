import { Chats } from "@phosphor-icons/react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { startConversationAction } from "@/app/app/conversations/actions";
import { StartConversationForm } from "@/components/chat/chat-screen";
import { BrandMark } from "@/components/brand/brand-mark";
import { CharacterProfile } from "@/components/characters/character-profile";
import { PublicShell } from "@/components/layout/public-shell";
import { LinkButton } from "@/components/ui/button";
import { getAuth } from "@/server/auth/auth";
import { listActiveConversations } from "@/server/chat/conversation-queries";
import { getPublicCharacterBySlug } from "@/server/characters/character-queries";
import { getPublicConfig } from "@/server/config/public-config";
import { getDatabase } from "@/server/db/database";

export const dynamic = "force-dynamic";

interface CharacterDetailPageProps {
  params: Promise<{ slug: string }>;
}

const navigationItems = [
  { href: "/characters", icon: Chats, label: "Characters" },
] as const;

export default async function CharacterDetailPage({
  params,
}: CharacterDetailPageProps) {
  const { slug } = await params;
  const [config, database] = await Promise.all([
    getPublicConfig(),
    getDatabase(),
  ]);
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
  const returnTo = `/characters/${character.slug}`;
  const primaryAction = signedIn ? (
    <StartConversationForm
      action={startConversationAction.bind(null, character.id, character.slug)}
      label={
        activeConversation ? "Continue conversation" : "Start conversation"
      }
    />
  ) : (
    <LinkButton
      className="character-profile__primary-action"
      href={`/auth/sign-in?returnTo=${encodeURIComponent(returnTo)}`}
      size="lg"
    >
      Sign in to start a conversation
    </LinkButton>
  );

  return (
    <PublicShell
      actions={
        signedIn ? (
          <LinkButton href="/app" size="sm" tone="quiet">
            Conversations
          </LinkButton>
        ) : (
          <LinkButton href="/auth/sign-in" size="sm" tone="quiet">
            Sign in
          </LinkButton>
        )
      }
      brand={<BrandMark branding={config.branding} />}
      navigationItems={[...navigationItems]}
      navigationLabel="Primary"
    >
      <div className="character-detail-page">
        <CharacterProfile action={primaryAction} character={character} />
      </div>
    </PublicShell>
  );
}
