import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { requireSession } from "@/server/auth/require-session";
import { getDatabase } from "@/server/db/database";
import { getRelationshipMemoryScreenView } from "@/server/memory/memory-queries";
import { RelationshipMemoryScreen } from "@/components/memory/relationship-memory-screen";
import {
  deleteMemoryAction,
  editMemoryAction,
  editSummaryAction,
  forgetCharacterAction,
  regenerateSummaryAction,
  retryExtractionAction,
  updateMemoryControlsAction,
} from "../actions";
import { renderApplicationRouteShell } from "../../route-shell";

export const dynamic = "force-dynamic";

export default async function CharacterMemoryPage({
  params,
}: {
  params: Promise<{ characterId: string }>;
}) {
  const { characterId } = await params;
  const session = await requireSession(await headers());
  const view = await getRelationshipMemoryScreenView(await getDatabase(), {
    userId: session.user.id,
    characterId,
  });
  if (!view) notFound();
  return renderApplicationRouteShell(
    <RelationshipMemoryScreen
      view={view}
      actions={{
        editMemory: editMemoryAction.bind(null, characterId),
        deleteMemory: deleteMemoryAction.bind(null, characterId),
        controls: updateMemoryControlsAction.bind(null, characterId),
        summary: editSummaryAction.bind(null, characterId),
        regenerate: regenerateSummaryAction.bind(null, characterId),
        forget: forgetCharacterAction.bind(null, characterId),
        retry: retryExtractionAction.bind(null, characterId),
      }}
    />,
  );
}
