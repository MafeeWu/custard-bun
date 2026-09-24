import { headers } from "next/headers";
import Link from "next/link";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { requireSession } from "@/server/auth/require-session";

export default async function ApplicationHomePage() {
  const session = await requireSession(await headers());
  const displayName = session.user.name || session.user.email;

  return (
    <main>
      <h1>Welcome, {displayName}</h1>
      <p>Your characters will appear here in the next delivery phase.</p>
      <Link href="/account">Account</Link>
      <SignOutButton />
    </main>
  );
}
