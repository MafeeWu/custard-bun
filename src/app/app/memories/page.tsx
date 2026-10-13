import { headers } from "next/headers";
import { requireSession } from "@/server/auth/require-session";
import { getDatabase } from "@/server/db/database";
import { listMemoryRelationships } from "@/server/memory/memory-queries";
import { MemoryRelationshipOverview } from "@/components/memory/memory-relationship-overview";
import { LinkButton } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Surface } from "@/components/ui/surface";
import { renderApplicationRouteShell } from "../route-shell";

export const dynamic = "force-dynamic";

export default async function MemoryPage() {
  const session = await requireSession(await headers());
  const relationships = await listMemoryRelationships(
    await getDatabase(),
    session.user.id,
  );
  return renderApplicationRouteShell(
    <div className="memory-page">
      <PageHeader
        actions={
          <LinkButton href="/account" size="sm" tone="secondary">
            Back to account privacy
          </LinkButton>
        }
        description="Manage what each character remembers and whether it is used in chat."
        eyebrow="Privacy & memory"
        title="Character memories"
      />
      <Surface as="section" className="memory-card" padding="lg" tone="raised">
        <div className="memory-section-heading">
          <div>
            <h2>Relationships</h2>
            <p>
              Each character keeps separate recording, recall, and deletion
              controls.
            </p>
          </div>
        </div>
        <MemoryRelationshipOverview relationships={relationships} />
      </Surface>
    </div>,
  );
}
