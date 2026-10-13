import { type ReactNode } from "react";
import { cx } from "./cx";

export type PageHeaderHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  headingLevel?: PageHeaderHeadingLevel;
  className?: string;
}

export function PageHeader({
  actions,
  className,
  description,
  eyebrow,
  headingLevel = 1,
  title,
}: PageHeaderProps) {
  const Heading = `h${headingLevel}` as const;

  return (
    <header className={cx("ui-page-header", className)}>
      <div className="ui-page-header__copy">
        {eyebrow ? <p className="ui-page-header__eyebrow">{eyebrow}</p> : null}
        <Heading className="ui-page-header__title">{title}</Heading>
        {description ? (
          <p className="ui-page-header__description">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="ui-page-header__actions">{actions}</div>
      ) : null}
    </header>
  );
}
