import { type ReactNode } from "react";
import { cx } from "@/components/ui/cx";
import { Surface } from "@/components/ui/surface";

interface AccountSectionProps {
  headingId: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  tone?: "default" | "danger";
}

export function AccountSection({
  actions,
  children,
  className,
  description,
  headingId,
  title,
  tone = "default",
}: AccountSectionProps) {
  return (
    <Surface
      aria-labelledby={headingId}
      as="section"
      className={cx(
        "account-section",
        tone === "danger" && "account-section--danger",
        className,
      )}
      padding="lg"
      tone={tone === "danger" ? "default" : "raised"}
    >
      <div className="account-section__header">
        <div className="account-section__copy">
          <h2 id={headingId}>{title}</h2>
          {description ? (
            <p className="account-section__description">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="account-section__actions">{actions}</div>
        ) : null}
      </div>
      <div className="account-section__body">{children}</div>
    </Surface>
  );
}
