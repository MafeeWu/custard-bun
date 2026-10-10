import { headers } from "next/headers";
import Link from "next/link";
import { DeleteAccountForm } from "@/components/account/delete-account-form";
import { requireSession } from "@/server/auth/require-session";
import { getDatabase } from "@/server/db/database";
import { listMemoryRelationships } from "@/server/memory/memory-queries";
import { MemoryRelationshipOverview } from "@/components/memory/memory-relationship-overview";
import { DataExportPanel } from "@/components/account/data-export-panel";
import { listDataExportsForUser } from "@/server/privacy/data-export-service";

export default async function AccountPage() {
  const session = await requireSession(await headers());
  const database = await getDatabase();
  const relationships = await listMemoryRelationships(database, session.user.id);
  const exports = await listDataExportsForUser(database, { userId: session.user.id, now: new Date() });

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

      <section aria-labelledby="account-privacy-heading">
        <h2 id="account-privacy-heading">Privacy</h2>
        <p>
          Control recording and chat usage, edit memories, or ask a character to
          forget you.
        </p>
        <Link href="/app/memories">Manage all character memories</Link>
        <MemoryRelationshipOverview relationships={relationships} />
      </section>

      <DataExportPanel exports={exports} />
      <DeleteAccountForm email={session.user.email} />
    </main>
  );
}
