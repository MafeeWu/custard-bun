import Link from "next/link";
import { HomeMotion } from "@/components/home/home-motion";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Surface } from "@/components/ui/surface";
import type { PublicAppConfig } from "@/server/config/schema";
import type { PublicCharacterSummary } from "@/server/characters/character-queries";

interface HomeSectionsProps {
  branding: PublicAppConfig["branding"];
  characters: readonly PublicCharacterSummary[];
  finalCtaHref: string;
  finalCtaLabel: string;
  supportHref: string;
}

export function HomeSections({
  branding,
  characters,
  finalCtaHref,
  finalCtaLabel,
  supportHref,
}: HomeSectionsProps) {
  return (
    <div className="home-sections">
      <section aria-labelledby="home-preview-heading" className="home-preview">
        <div className="home-section-heading">
          <p className="home-section-heading__eyebrow">Character preview</p>
          <h2 className="home-section-heading__title" id="home-preview-heading">
            A public catalog built from actual companions
          </h2>
        </div>

        {characters.length === 0 ? (
          <Surface className="home-preview__empty" padding="lg" tone="subtle">
            <EmptyState
              description="Publish official characters to turn this area into a curated set of conversation starting points."
              title="No public characters yet"
            />
          </Surface>
        ) : (
          <div className="home-preview__grid">
            <HomeMotion
              as="section"
              className="home-preview__feature"
              motionId="preview-feature"
              preset="riseIn"
            >
              <Surface
                as="article"
                className="home-preview-card"
                padding="lg"
                tone="raised"
              >
                <p className="home-preview-card__eyebrow">
                  Featured opening voice
                </p>
                <h3 className="home-preview-card__title">
                  {characters[0].displayName}
                </h3>
                <p className="home-preview-card__description">
                  {characters[0].shortDescription}
                </p>
                <blockquote className="home-preview-card__quote">
                  “{characters[0].openingMessage}”
                </blockquote>
                <Link
                  className="brand-link home-preview-card__link"
                  href={`/characters/${characters[0].slug}`}
                >
                  View {characters[0].displayName}
                </Link>
              </Surface>
            </HomeMotion>

            <HomeMotion
              as="section"
              className="home-preview__list"
              motionId="preview-list"
              preset="staggerChildren"
            >
              {characters.slice(1).map((character) => (
                <Surface
                  as="article"
                  className="home-preview-card home-preview-card--compact"
                  key={character.id}
                  padding="md"
                >
                  <p className="home-preview-card__eyebrow">
                    Character preview
                  </p>
                  <h3 className="home-preview-card__title">
                    {character.displayName}
                  </h3>
                  <p className="home-preview-card__description">
                    {character.shortDescription}
                  </p>
                  <p className="home-preview-card__quote home-preview-card__quote--compact">
                    “{character.openingMessage}”
                  </p>
                  <Link
                    className="brand-link home-preview-card__link"
                    href={`/characters/${character.slug}`}
                  >
                    Open profile
                  </Link>
                </Surface>
              ))}
            </HomeMotion>
          </div>
        )}
      </section>

      <div className="home-value-grid">
        <HomeMotion
          as="section"
          className="home-value home-value--privacy"
          motionId="privacy"
          preset="riseIn"
        >
          <Surface
            as="section"
            className="home-value__surface"
            padding="lg"
            tone="subtle"
          >
            <p className="home-section-heading__eyebrow">
              Privacy and self-hosting
            </p>
            <h2 className="home-section-heading__title">
              Your deployment, your conversations
            </h2>
            <p className="home-value__copy">
              Run {branding.name} inside infrastructure you control, keep the
              official catalog visible, and direct people into private
              conversations without routing them through a generic hosted
              marketing layer.
            </p>
          </Surface>
        </HomeMotion>

        <HomeMotion
          as="section"
          className="home-value home-value--continuity"
          motionId="continuity"
          preset="riseIn"
        >
          <Surface
            as="section"
            className="home-value__surface"
            padding="lg"
            tone="accent"
          >
            <p className="home-section-heading__eyebrow">
              Continuity and memory
            </p>
            <h2 className="home-section-heading__title">
              Characters that stay consistent
            </h2>
            <p className="home-value__copy">
              Shape durable tone, memory controls, and opening voice around each
              character so returning conversations keep their footing instead of
              resetting into a blank assistant every time.
            </p>
          </Surface>
        </HomeMotion>
      </div>

      <HomeMotion
        as="section"
        className="home-final-cta"
        motionId="final-cta"
        preset="riseIn"
      >
        <Surface
          as="section"
          className="home-final-cta__surface"
          padding="lg"
          tone="raised"
        >
          <div className="home-final-cta__copy">
            <p className="home-section-heading__eyebrow">Before you deploy</p>
            <h2 className="home-section-heading__title">
              Start with the boundaries you want to keep
            </h2>
            <p className="home-value__copy">
              Review the privacy expectations first, then move into signup or
              sign-in when you are ready to open conversations inside your own
              environment.
            </p>
          </div>
          <div className="home-final-cta__actions">
            <LinkButton href={finalCtaHref} size="lg" tone="secondary">
              {finalCtaLabel}
            </LinkButton>
          </div>
          <p className="home-final-cta__support">
            Need setup help?{" "}
            <Link className="brand-link" href={supportHref}>
              Support
            </Link>
          </p>
        </Surface>
      </HomeMotion>
    </div>
  );
}
