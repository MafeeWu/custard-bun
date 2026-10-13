import Link from "next/link";
import type { ReactNode } from "react";

export function AuthShell({
  aside,
  brand,
  children,
  description,
  footer,
  title,
}: {
  aside: ReactNode;
  brand: ReactNode;
  children: ReactNode;
  description?: string;
  footer?: ReactNode;
  title?: string;
}) {
  return (
    <div className="auth-shell">
      <div className="auth-shell__grid">
        <main className="auth-shell__main">
          <div className="auth-shell__panel">
            <Link className="shell-brand auth-shell__brand" href="/">
              <span className="shell-brand__name">{brand}</span>
            </Link>
            {title || description ? (
              <div className="auth-shell__copy">
                {title ? <h1>{title}</h1> : null}
                {description ? <p>{description}</p> : null}
              </div>
            ) : null}
            {children}
            {footer ? <div className="auth-shell__footer">{footer}</div> : null}
          </div>
        </main>
        <aside aria-label="Brand context" className="auth-shell__aside">
          {aside}
        </aside>
      </div>
    </div>
  );
}
