import type { Icon } from "@phosphor-icons/react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/components/ui/cx";
import { MobileNavigation } from "./mobile-navigation";

export interface ShellNavigationItem {
  href: string;
  label: string;
  icon: Icon;
}

export function ShellNavigation({
  className,
  items,
  label,
}: {
  className?: string;
  items: ShellNavigationItem[];
  label: string;
}) {
  return (
    <nav aria-label={label} className={cx("shell-nav", className)}>
      <ul className="shell-nav__list">
        {items.map(({ href, icon: IconComponent, label: itemLabel }) => (
          <li className="shell-nav__item" key={href}>
            <Link className="shell-nav__link" href={href}>
              <IconComponent aria-hidden="true" size={18} weight="fill" />
              <span className="shell-nav__link-label">{itemLabel}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function SiteHeader({
  actions,
  brand,
  brandHref = "/",
  className,
  mobileNavigationTitle,
  navigationItems,
  primaryNavigationLabel,
}: {
  actions?: ReactNode;
  brand: ReactNode;
  brandHref?: string;
  className?: string;
  mobileNavigationTitle?: string;
  navigationItems: ShellNavigationItem[];
  primaryNavigationLabel: string;
}) {
  const navigation = (
    <ShellNavigation items={navigationItems} label={primaryNavigationLabel} />
  );

  return (
    <header className={cx("shell-header", className)}>
      <div className="shell-header__inner">
        <Link className="shell-brand" href={brandHref}>
          <span className="shell-brand__name">{brand}</span>
        </Link>
        <div className="shell-header__desktop-nav">{navigation}</div>
        {actions ? <div className="shell-header__actions">{actions}</div> : null}
        <div className="shell-header__mobile-trigger">
          <MobileNavigation title={mobileNavigationTitle ?? primaryNavigationLabel}>
            {navigation}
            {actions ? (
              <div className="shell-mobile-navigation__actions">{actions}</div>
            ) : null}
          </MobileNavigation>
        </div>
      </div>
    </header>
  );
}
