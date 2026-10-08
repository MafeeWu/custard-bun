import { notFound } from "next/navigation";
import { CharacterProfile } from "@/components/characters/character-profile";
import { getPublicCharacterBySlug } from "@/server/characters/character-queries";
import { getDatabase } from "@/server/db/database";

export const dynamic = "force-dynamic";

interface CharacterDetailPageProps {
  params: Promise<{ slug: string }>;
}

export default async function CharacterDetailPage({
  params,
}: CharacterDetailPageProps) {
  const { slug } = await params;
  const database = await getDatabase();
  const character = await getPublicCharacterBySlug(database, slug);

  if (!character) {
    notFound();
  }

  return (
    <main className="page-shell">
      <CharacterProfile character={character} />
    </main>
  );
}
