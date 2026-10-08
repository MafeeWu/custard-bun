import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { CharacterPreview } from "@/components/admin/characters/character-preview";
import { requireAdmin } from "@/server/admin/require-admin";
import { getAdminCharacterPreview } from "@/server/characters/character-queries";
import { getDatabase } from "@/server/db/database";

export const dynamic = "force-dynamic";

export default async function CharacterPreviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin(await headers());
  const { id } = await params;
  const character = await getAdminCharacterPreview(await getDatabase(), id);
  if (!character) {
    notFound();
  }

  return (
    <section className="page-stack">
      <Link className="brand-link" href={`/admin/characters/${character.id}`}>
        Back to editor
      </Link>
      <h1>Preview persisted draft</h1>
      <CharacterPreview character={character} />
    </section>
  );
}
