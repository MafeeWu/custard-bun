import { headers } from "next/headers";
import { AdminDataList } from "@/components/admin/admin-data-list";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminSection } from "@/components/admin/admin-section";
import { requireAdmin } from "@/server/admin/require-admin";
import { getDatabase } from "@/server/db/database";
import { getGlobalMemorySettings } from "@/server/admin/memory-settings-service";
import {
  getMemoryOperationsDashboard,
  getMemoryOperationsDetails,
  getMemoryRetryCandidates,
} from "@/server/admin/memory-operations-queries";
import { GlobalMemorySettingsForm, MemoryRetryForms } from "./controls";

export const dynamic = "force-dynamic";

export default async function AdminMemoryOperationsPage() {
  await requireAdmin(await headers());
  const database = await getDatabase();
  const [dashboard, details, settings, candidates] = await Promise.all([
    getMemoryOperationsDashboard(database, new Date()),
    getMemoryOperationsDetails(database),
    getGlobalMemorySettings(database),
    getMemoryRetryCandidates(database),
  ]);

  return (
    <section className="admin-page">
      <AdminPageHeader
        title="Memory operations"
        description="Aggregate-only memory, export, and account removal status."
      />
      <AdminSection title="Processing queue" className="admin-section--queue">
        <ul>
          <li>Pending: {dashboard.jobs.pending}</li>
          <li>Running: {dashboard.jobs.running}</li>
          <li>Retrying: {dashboard.jobs.retrying}</li>
          <li>Failed: {dashboard.jobs.failed}</li>
          <li>Dead letter: {dashboard.jobs.deadLetter}</li>
          <li>
            Oldest pending:{" "}
            {details.oldestPendingAt?.toISOString() ?? "Unavailable"}
          </li>
          <li>
            Processing delay p50:{" "}
            {dashboard.processingDelayMs.p50 ?? "Unavailable"} ms
          </li>
          <li>
            Processing delay p95:{" "}
            {dashboard.processingDelayMs.p95 ?? "Unavailable"} ms
          </li>
        </ul>
      </AdminSection>
      <AdminSection title="Extraction and summary usage">
        <p>
          {dashboard.tokens.input} input / {dashboard.tokens.output} output
          tokens
        </p>
        <p>Estimated usage rows: {dashboard.tokens.estimatedRows}</p>
      </AdminSection>
      <AdminSection title="Exports">
        <p>Active: {dashboard.exports.active}</p>
        <p>
          Expired waiting for cleanup: {dashboard.exports.expiredBytes} bytes
        </p>
        {details.exportStates.map(({ state, count }) => (
          <p key={state}>
            {state}: {count}
          </p>
        ))}
      </AdminSection>
      <AdminSection title="Purge stages">
        <AdminDataList
          ariaLabel="Purge stages"
          columns={[
            {
              key: "stage",
              header: "Stage",
              priority: "primary",
              cell: (purge) => purge.stage,
            },
            {
              key: "count",
              header: "Count",
              priority: "secondary",
              cell: (purge) => purge.count,
            },
            {
              key: "oldest",
              header: "Oldest",
              priority: "detail",
              cell: (purge) => purge.oldestAt?.toISOString() ?? "Unavailable",
            },
          ]}
          emptyTitle="No purge stages"
          getRowKey={(purge) => purge.stage}
          rows={dashboard.purges}
        />
      </AdminSection>
      <AdminSection title="Operation failures">
        <AdminDataList
          ariaLabel="Operation failures"
          columns={[
            {
              key: "category",
              header: "Category",
              priority: "primary",
              cell: (failure) => failure.category,
            },
            {
              key: "count",
              header: "Count",
              priority: "secondary",
              cell: (failure) => failure.count,
            },
          ]}
          emptyTitle="No operation failures"
          getRowKey={(failure) => failure.category}
          rows={dashboard.failures}
        />
      </AdminSection>
      <GlobalMemorySettingsForm settings={settings} />
      <MemoryRetryForms candidates={candidates} />
    </section>
  );
}
