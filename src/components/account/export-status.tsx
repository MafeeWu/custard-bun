import { type ReactNode } from "react";
import { StatusNotice, type NoticeTone } from "@/components/ui/status-notice";

export type ExportVisualState =
  | { kind: "idle" }
  | { kind: "queued" }
  | { kind: "processing" }
  | { kind: "ready"; expiresAt: Date; downloadHref: string }
  | { kind: "expired" }
  | { kind: "failed"; message: string };

interface ExportStatusProps {
  state: ExportVisualState;
  requestedAt?: string;
  action?: ReactNode;
}

const statusMetadata: Record<
  ExportVisualState["kind"],
  { title: string; tone: NoticeTone }
> = {
  idle: { title: "No export requested", tone: "info" },
  queued: { title: "Queued", tone: "info" },
  processing: { title: "Processing", tone: "info" },
  ready: { title: "Ready", tone: "success" },
  expired: { title: "Expired", tone: "warning" },
  failed: { title: "Failed", tone: "danger" },
};

function formatDateTime(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date);
}

export function ExportStatus({
  action,
  requestedAt,
  state,
}: ExportStatusProps) {
  const metadata = statusMetadata[state.kind];

  return (
    <li
      className={`account-export-status account-export-status--${state.kind}`}
    >
      <StatusNotice
        className="account-export-status__notice"
        title={metadata.title}
        tone={metadata.tone}
      >
        <div className="account-export-status__copy">
          {requestedAt ? (
            <p className="account-export-status__meta">
              Requested{" "}
              <time dateTime={requestedAt}>{formatDateTime(requestedAt)}</time>
            </p>
          ) : null}
          {state.kind === "ready" ? (
            <p className="account-export-status__meta">
              Expires{" "}
              <time dateTime={state.expiresAt.toISOString()}>
                {formatDateTime(state.expiresAt)}
              </time>
            </p>
          ) : null}
          {state.kind === "failed" ? (
            <p className="account-export-status__message">{state.message}</p>
          ) : null}
        </div>
      </StatusNotice>
      {state.kind === "ready" ? (
        <div className="account-export-status__actions">
          <a
            className="ui-button ui-button--secondary ui-button--md account-export-status__download"
            href={state.downloadHref}
          >
            <span className="ui-button__label">Download ZIP</span>
          </a>
        </div>
      ) : null}
      {action ? (
        <div className="account-export-status__actions">{action}</div>
      ) : null}
    </li>
  );
}
