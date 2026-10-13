import type { ReactNode } from "react";
import { SiteHeader, type ShellNavigationItem } from "./site-header";

export function PublicShell({
  actions,
  brand,
  children,
  navigationItems,
}: {
  actions?: ReactNode;
  brand: ReactNode;
  children: ReactNode;
  navigationItems: ShellNavigationItem[];
}) {
  return (
    <div className="shell shell--public">
      <SiteHeader
        actions={actions}
        brand={brand}
        navigationItems={navigationItems}
        primaryNavigationLabel="Primary navigation"
      />
      <main className="shell-main shell-main--public">{children}</main>
    </div>
  );
}
