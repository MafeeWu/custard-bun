import Link from "next/link";
import type { ReactNode } from "react";
import { MobileNavigation } from "./mobile-navigation";
import { ShellNavigation, type ShellNavigationItem } from "./site-header";

export function AdminShell({
  brand,
  children,
  navigationItems,
}: {
  brand: ReactNode;
  children: ReactNode;
  navigationItems: ShellNavigationItem[];
}) {
  const navigation = (
    <ShellNavigation
      className="shell-nav--stacked"
      items={navigationItems}
      label="Administration"
    />
  );

  return (
    <div className="shell shell--admin">
      <header className="shell-admin__header">
        <div className="shell-admin__header-inner">
          <Link className="shell-brand" href="/admin">
            <span className="shell-brand__name">{brand}</span>
          </Link>
          <div className="shell-admin__mobile-trigger">
            <MobileNavigation title="Administration">
              {navigation}
            </MobileNavigation>
          </div>
        </div>
      </header>
      <div className="shell-admin__layout">
        <aside className="shell-admin__sidebar">{navigation}</aside>
        <main className="shell-main shell-main--admin">{children}</main>
      </div>
    </div>
  );
}
