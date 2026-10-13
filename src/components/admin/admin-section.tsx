import { useId, type ReactNode } from "react";
import { Surface } from "@/components/ui/surface";
import { cx } from "@/components/ui/cx";

export function AdminSection({
  actions,
  children,
  className,
  description,
  title,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const headingId = useId();

  return (
    <Surface
      as="section"
      aria-labelledby={headingId}
      className={cx("admin-section", className)}
      padding="md"
    >
      <div className="admin-section__header">
        <div className="admin-section__copy">
          <h2 className="admin-section__title" id={headingId}>
            {title}
          </h2>
          {description ? (
            <p className="admin-section__description">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="admin-section__actions">{actions}</div>
        ) : null}
      </div>
      <div className="admin-section__body">{children}</div>
    </Surface>
  );
}
