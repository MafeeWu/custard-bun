import type { ReactNode } from "react";
import { SiteHeader, type ShellNavigationItem } from "./site-header";

export function AppShell({
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
    <div className="shell shell--app">
      <SiteHeader
        actions={actions}
        brand={brand}
        brandHref="/app"
        mobileNavigationTitle="Application navigation"
        navigationItems={navigationItems}
        primaryNavigationLabel="Application navigation"
      />
      <main className="shell-main shell-main--app">{children}</main>
    </div>
  );
}
