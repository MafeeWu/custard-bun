import { headers } from "next/headers";
import Link from "next/link";
import { requireSession } from "@/server/auth/require-session";
import { getDatabase } from "@/server/db/database";
import { listMemoryRelationships } from "@/server/memory/memory-queries";
import { MemoryRelationshipOverview } from "@/components/memory/memory-relationship-overview";

export const dynamic = "force-dynamic";

export default async function MemoryPage() {
  const session = await requireSession(await headers());
  const relationships = await listMemoryRelationships(
    await getDatabase(),
    session.user.id,
  );
  return (
    <main className="memory-page">
      <h1>Character memories</h1>
      <p>
        Manage what each character remembers and whether it is used in chat.
      </p>
      <Link href="/account">Back to account privacy</Link>
      <MemoryRelationshipOverview relationships={relationships} />
    </main>
  );
}
