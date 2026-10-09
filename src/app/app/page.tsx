import { headers } from "next/headers";
import Image from "next/image";
import Link from "next/link";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { requireSession } from "@/server/auth/require-session";
import { listActiveConversations } from "@/server/chat/conversation-queries";
import { getDatabase } from "@/server/db/database";

export default async function ApplicationHomePage() {
  const session = await requireSession(await headers());
  const displayName = session.user.name || session.user.email;
  const conversations = await listActiveConversations(
    await getDatabase(),
    session.user.id,
  );

  return (
    <main className="page-shell page-stack">
      <h1>Welcome, {displayName}</h1>
      <p>Continue a conversation or browse the official character catalog.</p>
      {conversations.length ? (
        <ul className="conversation-grid">
          {conversations.map((conversation) => (
            <li key={conversation.id}>
              <Link
                className="conversation-card"
                href={`/app/conversations/${conversation.id}`}
              >
                <Image
                  alt=""
                  height={64}
                  src={conversation.character.avatarPath}
                  width={64}
                />
                <span>
                  <strong>{conversation.character.displayName}</strong>
                  <span>
                    Continue with {conversation.character.displayName}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p>You have no active conversations yet.</p>
      )}
      <div className="page-actions">
        <Link className="brand-primary" href="/characters">
          Browse characters
        </Link>
        <Link className="brand-link" href="/account">
          Account
        </Link>
      </div>
      <SignOutButton />
    </main>
  );
}
