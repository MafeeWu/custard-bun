import type { ReactNode } from "react";
import { SiteHeader, type ShellNavigationItem } from "./site-header";

export function FocusedChatShell({
  brand,
  children,
  navigationItems,
}: {
  brand: ReactNode;
  children: ReactNode;
  navigationItems: ShellNavigationItem[];
}) {
  return (
    <div className="shell shell--focused-chat">
      <SiteHeader
        brand={brand}
        brandHref="/app"
        mobileNavigationTitle="Application navigation"
        navigationItems={navigationItems}
        primaryNavigationLabel="Application navigation"
      />
      <main className="shell-main shell-main--focused-chat">{children}</main>
    </div>
  );
}
