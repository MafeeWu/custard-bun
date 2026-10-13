import { headers } from "next/headers";
import Link from "next/link";
import { ApplicationEmptyState } from "@/components/app/application-empty-state";
import { ConversationCard } from "@/components/app/conversation-card";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { LinkButton } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Surface } from "@/components/ui/surface";
import { requireSession } from "@/server/auth/require-session";
import { listActiveConversations } from "@/server/chat/conversation-queries";
import { getPublicConfig } from "@/server/config/public-config";
import { getDatabase } from "@/server/db/database";

export default async function ApplicationHomePage() {
  const requestHeaders = await headers();
  const [session, config, database] = await Promise.all([
    requireSession(requestHeaders),
    getPublicConfig(),
    getDatabase(),
  ]);
  const displayName = session.user.name || session.user.email;
  const conversations = await listActiveConversations(
    database,
    session.user.id,
  );
  const showAdminLink = session.user.role === "admin";

  return (
    <main className="application-home">
      <PageHeader
        actions={
          conversations.length ? (
            <LinkButton href="/characters">Browse characters</LinkButton>
          ) : undefined
        }
        className="application-home__header"
        description={
          conversations.length
            ? `Continue the threads that already know ${displayName}.`
            : `Browse the official ${config.branding.name} character catalog and start your first conversation when you're ready.`
        }
        eyebrow="Welcome back"
        title="Conversations"
      />
      <div className="application-home__layout">
        <Surface
          aria-labelledby="application-home-active-heading"
          as="section"
          className="application-home__primary"
          padding="lg"
          tone="raised"
        >
          <div className="application-home__section-heading">
            <div className="application-home__section-copy">
              <h2 id="application-home-active-heading">Active conversations</h2>
              <p>
                Continue an ongoing thread or browse the official catalog when
                you want a new companion.
              </p>
            </div>
          </div>
          {conversations.length ? (
            <ul className="application-home__conversation-list">
              {conversations.map((conversation) => (
                <li key={conversation.id}>
                  <ConversationCard
                    character={conversation.character}
                    id={conversation.id}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <ApplicationEmptyState branding={config.branding} />
          )}
        </Surface>
        <Surface
          aria-labelledby="application-home-account-heading"
          as="div"
          className="application-home__account"
          padding="md"
          role="complementary"
          tone="subtle"
        >
          <div className="application-home__account-copy">
            <h2 id="application-home-account-heading">Account</h2>
            <p className="application-home__account-name">{displayName}</p>
            <p className="application-home__account-note">
              Open Memories and account settings from the application
              navigation.
            </p>
            {showAdminLink ? (
              <Link className="brand-link" href="/admin">
                Admin
              </Link>
            ) : null}
          </div>
          <SignOutButton />
        </Surface>
      </div>
    </main>
  );
}
