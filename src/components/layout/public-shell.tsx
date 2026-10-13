import type { ReactNode } from "react";
import { LinkButton } from "@/components/ui/button";
import { SiteHeader, type ShellNavigationItem } from "./site-header";

export function PublicShell({
  actions,
  brand,
  children,
  navigationLabel,
  navigationItems,
  signInHref,
}: {
  actions?: ReactNode;
  brand: ReactNode;
  children: ReactNode;
  navigationLabel?: string;
  navigationItems: ShellNavigationItem[];
  signInHref?: string;
}) {
  const headerActions = actions ?? (
    <LinkButton href={signInHref ?? "/auth/sign-in"} size="sm" tone="quiet">
      Sign in
    </LinkButton>
  );

  return (
    <div className="shell shell--public">
      <SiteHeader
        actions={headerActions}
        brand={brand}
        navigationItems={navigationItems}
        primaryNavigationLabel={navigationLabel ?? "Primary navigation"}
      />
      <main className="shell-main shell-main--public">{children}</main>
    </div>
  );
}
