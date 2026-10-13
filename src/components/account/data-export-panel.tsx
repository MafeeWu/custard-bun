"use client";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  getDataExportStatusAction,
  requestDataExportAction,
  retryDataExportAction,
  type DataExportActionState,
} from "@/app/account/exports/actions";
import { Button } from "@/components/ui/button";
import { StatusNotice } from "@/components/ui/status-notice";
import type { DataExportView } from "@/server/privacy/data-export-service";
import { AccountSection } from "./account-section";
import { ExportStatus, type ExportVisualState } from "./export-status";

const initial: DataExportActionState = { status: "idle" };
function RetryExport({ id, disabled }: { id: string; disabled: boolean }) {
  const [state, action, pending] = useActionState(
    retryDataExportAction,
    initial,
  );

  return (
    <form action={action} className="account-export-status__retry">
      <input type="hidden" name="exportId" value={id} />
      <Button
        disabled={disabled}
        pending={pending}
        tone="secondary"
        type="submit"
      >
        Retry export
      </Button>
      {state.message && (
        <StatusNotice
          className="account-export-status__feedback"
          tone={state.status === "error" ? "danger" : "success"}
        >
          {state.message}
        </StatusNotice>
      )}
    </form>
  );
}

function visualStateForJob(job: DataExportView): ExportVisualState {
  switch (job.status) {
    case "pending":
      return { kind: "queued" };
    case "running":
      return { kind: "processing" };
    case "complete":
      return {
        kind: "ready",
        downloadHref: `/account/exports/${job.id}/download`,
        expiresAt: new Date(job.expiresAt ?? job.completedAt ?? job.createdAt),
      };
    case "expired":
      return { kind: "expired" };
    case "failed":
    case "cancelled":
      return { kind: "failed", message: "Data export is unavailable." };
    default: {
      const unhandledStatus: never = job.status;
      throw new Error(`Unhandled data export status: ${unhandledStatus}`);
    }
  }
}

export function DataExportPanel({ exports }: { exports: DataExportView[] }) {
  const [state, action, pending] = useActionState(
    requestDataExportAction,
    initial,
  );
  const router = useRouter();
  const active = exports.filter(
    (job) => job.status === "pending" || job.status === "running",
  );
  const activeKey = active.map((job) => job.id).join(",");
  const requestedId =
    state.exportId &&
    !exports.some(
      (job) =>
        job.id === state.exportId &&
        job.status !== "pending" &&
        job.status !== "running",
    )
      ? state.exportId
      : undefined;
  useEffect(() => {
    if (!activeKey && !requestedId) return;
    let stopped = false;
    let checking = false;
    const ids = [
      ...new Set([
        ...activeKey.split(",").filter(Boolean),
        ...(requestedId ? [requestedId] : []),
      ]),
    ];
    const timer = setInterval(() => {
      if (checking) return;
      checking = true;
      void Promise.all(ids.map((id) => getDataExportStatusAction(id)))
        .then((results) => {
          if (
            !stopped &&
            results.every(
              (job) =>
                job && job.status !== "pending" && job.status !== "running",
            )
          ) {
            clearInterval(timer);
            router.refresh();
          }
        })
        .catch(() => undefined)
        .finally(() => {
          checking = false;
        });
    }, 5000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [activeKey, requestedId, router]);

  return (
    <AccountSection
      description={
        <>
          Request a private ZIP containing JSON copies of your account,
          conversations, memories, summaries, settings, and usage. Only you can
          download it. Downloads expire 24 hours after completion.
        </>
      }
      headingId="data-export-heading"
      title="Export your data"
    >
      <form action={action} className="account-export-panel__request">
        <Button disabled={active.length > 0} pending={pending} type="submit">
          Request data export
        </Button>
        {state.message && (
          <StatusNotice
            className="account-export-status__feedback"
            tone={state.status === "error" ? "danger" : "success"}
          >
            {state.message}
          </StatusNotice>
        )}
      </form>

      <ol className="account-export-status-list">
        {exports.length ? (
          exports.map((job) => {
            const visualState = visualStateForJob(job);

            return (
              <ExportStatus
                action={
                  job.status === "failed" ? (
                    <RetryExport id={job.id} disabled={active.length > 0} />
                  ) : undefined
                }
                key={job.id}
                requestedAt={job.createdAt}
                state={visualState}
              />
            );
          })
        ) : (
          <ExportStatus state={{ kind: "idle" }} />
        )}
      </ol>
    </AccountSection>
  );
}
