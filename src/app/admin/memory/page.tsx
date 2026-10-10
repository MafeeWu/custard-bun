import { headers } from "next/headers";
import { requireAdmin } from "@/server/admin/require-admin";
import { getDatabase } from "@/server/db/database";
import { getGlobalMemorySettings } from "@/server/admin/memory-settings-service";
import { getMemoryOperationsDashboard, getMemoryOperationsDetails, getMemoryRetryCandidates } from "@/server/admin/memory-operations-queries";
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
    <section className="page-stack">
      <header>
        <h1>Memory operations</h1>
        <p>Aggregate-only memory, export, and account removal status.</p>
      </header>
      <section aria-label="Memory queue">
        <h2>Processing queue</h2>
        <ul>
          <li>Pending: {dashboard.jobs.pending}</li>
          <li>Running: {dashboard.jobs.running}</li>
          <li>Retrying: {dashboard.jobs.retrying}</li>
          <li>Failed: {dashboard.jobs.failed}</li>
          <li>Dead letter: {dashboard.jobs.deadLetter}</li>
          <li>Oldest pending: {details.oldestPendingAt?.toISOString() ?? "Unavailable"}</li>
          <li>Processing delay p50: {dashboard.processingDelayMs.p50 ?? "Unavailable"} ms</li>
          <li>Processing delay p95: {dashboard.processingDelayMs.p95 ?? "Unavailable"} ms</li>
        </ul>
      </section>
      <section aria-label="Background tokens">
        <h2>Extraction and summary usage</h2>
        <p>{dashboard.tokens.input} input / {dashboard.tokens.output} output tokens</p>
        <p>Estimated usage rows: {dashboard.tokens.estimatedRows}</p>
      </section>
      <section aria-label="Data exports">
        <h2>Exports</h2>
        <p>Active: {dashboard.exports.active}</p>
        <p>Expired waiting for cleanup: {dashboard.exports.expiredBytes} bytes</p>
        {details.exportStates.map(({ state, count }) => <p key={state}>{state}: {count}</p>)}
      </section>
      <table aria-label="Purge stages">
        <thead><tr><th scope="col">Stage</th><th scope="col">Count</th><th scope="col">Oldest</th></tr></thead>
        <tbody>{dashboard.purges.map(({ stage, count, oldestAt }) =>
          <tr key={stage}><td>{stage}</td><td>{count}</td><td>{oldestAt?.toISOString() ?? "Unavailable"}</td></tr>)}</tbody>
      </table>
      <table aria-label="Operation failures">
        <thead><tr><th scope="col">Category</th><th scope="col">Count</th></tr></thead>
        <tbody>{dashboard.failures.map(({ category, count }) =>
          <tr key={category}><td>{category}</td><td>{count}</td></tr>)}</tbody>
      </table>
      <GlobalMemorySettingsForm settings={settings} />
      <MemoryRetryForms candidates={candidates} />
    </section>
  );
}
