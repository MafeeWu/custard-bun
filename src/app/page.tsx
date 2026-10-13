import { Chats } from "@phosphor-icons/react/ssr";
import { BrandMark } from "@/components/brand/brand-mark";
import { HomeHero } from "@/components/home/home-hero";
import { HomeSections } from "@/components/home/home-sections";
import { PublicShell } from "@/components/layout/public-shell";
import { listPublicCharacters } from "@/server/characters/character-queries";
import { getPublicConfig } from "@/server/config/public-config";
import { getDatabase } from "@/server/db/database";

export const dynamic = "force-dynamic";

const navigationItems = [
  { href: "/characters", icon: Chats, label: "Characters" },
] as const;

export default async function HomePage() {
  const [config, database] = await Promise.all([
    getPublicConfig(),
    getDatabase(),
  ]);
  const characters = (await listPublicCharacters(database)).slice(0, 3);

  return (
    <PublicShell
      brand={<BrandMark branding={config.branding} />}
      navigationItems={[...navigationItems]}
      navigationLabel="Primary"
    >
      <div className="home-page">
        <HomeHero
          branding={config.branding}
          characters={characters}
          registrationOpen={config.registration.open}
        />
        <HomeSections
          branding={config.branding}
          characters={characters}
          finalCtaHref={config.links.privacyUrl}
          finalCtaLabel="Review privacy details"
          supportHref={config.links.supportUrl}
        />
      </div>
    </PublicShell>
  );
}
