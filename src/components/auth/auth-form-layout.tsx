import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/brand/brand-mark";
import { Avatar } from "@/components/ui/avatar";
import type { PublicAppConfig } from "@/server/config/schema";

export interface AuthFormLayoutProps {
  title: string;
  description: string;
  children: ReactNode;
  alternateAction?: ReactNode;
  legalLinks: PublicAppConfig["links"];
}

const authPanelCharacters = [
  {
    name: "Calm Listener",
    note: "Thoughtful replies",
    src: "/characters/calm-listener.svg",
  },
  {
    name: "Creative Storyteller",
    note: "Long-form scenes",
    src: "/characters/creative-storyteller.svg",
  },
  {
    name: "Rational Companion",
    note: "Grounded perspective",
    src: "/characters/rational-companion.svg",
  },
] as const;

export function AuthFormLayout({
  alternateAction,
  children,
  description,
  legalLinks,
  title,
}: AuthFormLayoutProps) {
  return (
    <div className="auth-form-layout">
      <div className="auth-form-layout__header">
        <h1 className="auth-form-layout__title">{title}</h1>
        {description ? (
          <p className="auth-form-layout__description">{description}</p>
        ) : null}
      </div>
      <div className="auth-form-layout__body">{children}</div>
      {alternateAction ? (
        <div className="auth-form-layout__alternate">{alternateAction}</div>
      ) : null}
      <p className="auth-form-layout__legal">
        <Link href={legalLinks.privacyUrl}>Privacy</Link> ·{" "}
        <Link href={legalLinks.termsUrl}>Terms</Link> ·{" "}
        <Link href={legalLinks.supportUrl}>Support</Link>
      </p>
    </div>
  );
}

export function AuthBrandPanel({
  branding,
}: {
  branding: PublicAppConfig["branding"];
}) {
  return (
    <div className="auth-brand-panel">
      <div className="auth-brand-panel__copy">
        <p className="auth-brand-panel__eyebrow">Private companion access</p>
        <div className="auth-brand-panel__brand">
          <BrandMark branding={branding} />
        </div>
        <p className="auth-brand-panel__description">{branding.description}</p>
      </div>
      <div aria-hidden="true" className="auth-brand-panel__portraits">
        {authPanelCharacters.map((character) => (
          <div className="auth-brand-panel__portrait" key={character.name}>
            <Avatar name={character.name} size="lg" src={character.src} />
            <div className="auth-brand-panel__portrait-copy">
              <p className="auth-brand-panel__portrait-name">
                {character.name}
              </p>
              <p className="auth-brand-panel__portrait-note">
                {character.note}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
