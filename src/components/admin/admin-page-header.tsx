import { type ReactNode } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { cx } from "@/components/ui/cx";

export function AdminPageHeader({
  actions,
  className,
  description,
  eyebrow = "Administration",
  title,
}: {
  title: string;
  description?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <PageHeader
      actions={actions}
      className={cx("admin-page-header", className)}
      description={description}
      eyebrow={eyebrow}
      title={title}
    />
  );
}
