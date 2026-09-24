import { headers } from "next/headers";
import Link from "next/link";
import { DeleteAccountForm } from "@/components/account/delete-account-form";
import { requireSession } from "@/server/auth/require-session";

export default async function AccountPage() {
  const session = await requireSession(await headers());

  return (
    <main>
      <h1>Account</h1>
      <dl>
        <dt>Name</dt>
        <dd>{session.user.name}</dd>
        <dt>Email</dt>
        <dd>{session.user.email}</dd>
        <dt>Email status</dt>
        <dd>{session.user.emailVerified ? "Verified" : "Unverified"}</dd>
      </dl>

      <Link href="/auth/forgot-password">Reset password</Link>

      <DeleteAccountForm email={session.user.email} />
    </main>
  );
}
