"use client";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  getDataExportStatusAction,
  requestDataExportAction,
  retryDataExportAction,
  type DataExportActionState,
} from "@/app/account/exports/actions";
import type { DataExportView } from "@/server/privacy/data-export-service";

const initial: DataExportActionState = { status: "idle" };
const labels: Record<DataExportView["status"], string> = {
  pending: "Pending",
  running: "Preparing",
  complete: "Ready",
  failed: "Failed",
  expired: "Expired",
  cancelled: "Cancelled",
};
function RetryExport({ id, disabled }: { id: string; disabled: boolean }) {
  const [state, action, pending] = useActionState(
    retryDataExportAction,
    initial,
  );
  return (
    <form action={action}>
      <input type="hidden" name="exportId" value={id} />
      <button disabled={disabled || pending}>Retry export</button>
      {state.message && (
        <p role={state.status === "error" ? "alert" : "status"}>
          {state.message}
        </p>
      )}
    </form>
  );
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
    <section aria-labelledby="data-export-heading">
      <h2 id="data-export-heading">Export your data</h2>
      <p>
        Request a private ZIP containing JSON copies of your account,
        conversations, memories, summaries, settings, and usage. Only you can
        download it. Downloads expire 24 hours after completion.
      </p>
      <form action={action}>
        <button disabled={pending || active.length > 0}>
          Request data export
        </button>
        {state.message && (
          <p role={state.status === "error" ? "alert" : "status"}>
            {state.message}
          </p>
        )}
      </form>
      <ul>
        {exports.map((job) => (
          <li key={job.id}>
            <span>{labels[job.status]}</span>{" "}
            <time dateTime={job.createdAt}>{job.createdAt}</time>
            {job.status === "complete" && job.expiresAt && (
              <>
                {" "}
                <a href={`/account/exports/${job.id}/download`}>
                  Download ZIP
                </a>{" "}
                Expires <time dateTime={job.expiresAt}>{job.expiresAt}</time>
              </>
            )}
            {job.status === "failed" && (
              <RetryExport id={job.id} disabled={active.length > 0} />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
