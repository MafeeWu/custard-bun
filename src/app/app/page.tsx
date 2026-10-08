import { headers } from "next/headers";
import Link from "next/link";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { requireSession } from "@/server/auth/require-session";

export default async function ApplicationHomePage() {
  const session = await requireSession(await headers());
  const displayName = session.user.name || session.user.email;

  return (
    <main className="page-shell page-stack">
      <h1>Welcome, {displayName}</h1>
      <p>Browse the official character catalog before you start a conversation.</p>
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
