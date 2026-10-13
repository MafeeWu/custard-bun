import type { ReactNode } from "react";
import {
  ShellNavigation,
  SiteHeader,
  type ShellNavigationItem,
} from "./site-header";

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
        showDesktopNavigation={false}
      />
      <div className="shell-app__layout">
        <aside
          aria-label="Application navigation"
          className="shell-app__sidebar"
        >
          <ShellNavigation
            className="shell-nav--stacked"
            items={navigationItems}
            label="Application navigation"
          />
        </aside>
        <main className="shell-main shell-main--app">{children}</main>
      </div>
    </div>
  );
}
