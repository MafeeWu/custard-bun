import { type ReactNode } from "react";
import { cx } from "./cx";

export interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  artwork?: ReactNode;
  className?: string;
}

export function EmptyState({
  action,
  artwork,
  className,
  description,
  title,
}: EmptyStateProps) {
  return (
    <section className={cx("ui-empty-state", className)}>
      {artwork ? (
        <div className="ui-empty-state__artwork">{artwork}</div>
      ) : null}
      <div className="ui-empty-state__copy">
        <h2 className="ui-empty-state__title">{title}</h2>
        {description ? (
          <p className="ui-empty-state__description">{description}</p>
        ) : null}
      </div>
      {action ? <div className="ui-empty-state__action">{action}</div> : null}
    </section>
  );
}
