import { Chats } from "@phosphor-icons/react/ssr";
import { BrandMark } from "@/components/brand/brand-mark";
import { CharacterCard } from "@/components/characters/character-card";
import { CharacterGridMotion } from "@/components/characters/character-grid-motion";
import { PublicShell } from "@/components/layout/public-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { listPublicCharacters } from "@/server/characters/character-queries";
import { getPublicConfig } from "@/server/config/public-config";
import { getDatabase } from "@/server/db/database";

export const dynamic = "force-dynamic";

const navigationItems = [
  { href: "/characters", icon: Chats, label: "Characters" },
] as const;

export default async function CharactersCatalogPage() {
  const [config, database] = await Promise.all([
    getPublicConfig(),
    getDatabase(),
  ]);
  const characters = await listPublicCharacters(database);
  const featuredLayout = characters.length >= 3;

  return (
    <PublicShell
      brand={<BrandMark branding={config.branding} />}
      navigationItems={[...navigationItems]}
      navigationLabel="Primary"
    >
      <div className="character-catalog-page">
        <PageHeader
          description="Meet the official companions available for new conversations across this app."
          eyebrow="Official catalog"
          title="Browse characters"
        />
        {characters.length === 0 ? (
          <EmptyState
            className="character-catalog-empty"
            description="Publish official characters to turn this page into a curated set of conversation starting points."
            title="No official characters are available right now"
          />
        ) : (
          <CharacterGridMotion featuredLayout={featuredLayout}>
            {characters.map((character, index) => (
              <CharacterCard
                character={character}
                emphasis={
                  featuredLayout && index === 0 ? "featured" : "standard"
                }
                index={index}
                key={character.id}
              />
            ))}
          </CharacterGridMotion>
        )}
      </div>
    </PublicShell>
  );
}
