import { CharacterStage } from "@/components/home/character-stage";
import { HomeMotion } from "@/components/home/home-motion";
import { LinkButton } from "@/components/ui/button";
import type { PublicAppConfig } from "@/server/config/schema";
import type { PublicCharacterSummary } from "@/server/characters/character-queries";

export interface HomeHeroProps {
  branding: PublicAppConfig["branding"];
  registrationOpen: boolean;
  characters: readonly PublicCharacterSummary[];
}

export function HomeHero({
  branding,
  characters,
  registrationOpen,
}: HomeHeroProps) {
  return (
    <section className="home-hero">
      <HomeMotion
        className="home-hero__copy"
        motionId="hero-copy"
        preset="riseIn"
      >
        <p className="home-hero__eyebrow">{branding.name}</p>
        <h1 className="home-hero__headline">
          Conversations with character. Continuity you control.
        </h1>
        <p className="home-hero__description">{branding.description}</p>
        <div className="home-hero__actions">
          <LinkButton
            href={registrationOpen ? "/auth/sign-up" : "/auth/sign-in"}
            size="lg"
          >
            Get started
          </LinkButton>
          <LinkButton href="/characters" size="lg" tone="secondary">
            Browse characters
          </LinkButton>
        </div>
      </HomeMotion>

      <HomeMotion
        className="home-hero__stage"
        motionId="hero-stage"
        preset="riseIn"
      >
        <CharacterStage characters={characters} />
      </HomeMotion>
    </section>
  );
}
