import { type ReactNode } from "react";
import { cx } from "./cx";

export type NoticeTone = "info" | "success" | "warning" | "danger";

export interface StatusNoticeProps {
  tone?: NoticeTone;
  title?: string;
  children: ReactNode;
  className?: string;
}

const toneClassNames: Record<NoticeTone, string> = {
  info: "ui-status-notice--info",
  success: "ui-status-notice--success",
  warning: "ui-status-notice--warning",
  danger: "ui-status-notice--danger",
};

const liveRoles: Record<NoticeTone, "status" | "alert"> = {
  info: "status",
  success: "status",
  warning: "alert",
  danger: "alert",
};

export function StatusNotice({
  children,
  className,
  title,
  tone = "info",
}: StatusNoticeProps) {
  const role = liveRoles[tone];

  return (
    <div
      aria-live={role === "alert" ? "assertive" : "polite"}
      className={cx("ui-status-notice", toneClassNames[tone], className)}
      role={role}
    >
      {title ? <p className="ui-status-notice__title">{title}</p> : null}
      <div className="ui-status-notice__body">{children}</div>
    </div>
  );
}
