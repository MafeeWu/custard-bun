import { headers } from "next/headers";
import { AdminDataList } from "@/components/admin/admin-data-list";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminSection } from "@/components/admin/admin-section";
import { ChatSettingsForm } from "@/components/admin/usage/chat-settings-form";
import { requireAdmin } from "@/server/admin/require-admin";
import { getGlobalChatSettings } from "@/server/admin/chat-settings-service";
import { getUsageDashboard } from "@/server/admin/usage-queries";
import { getDatabase } from "@/server/db/database";

export const dynamic = "force-dynamic";

function tokens(inputTokens: number, outputTokens: number) {
  return `${inputTokens} input / ${outputTokens} output tokens`;
}

export default async function AdminUsagePage() {
  await requireAdmin(await headers());
  const database = await getDatabase();
  const [dashboard, settings] = await Promise.all([
    getUsageDashboard(database, new Date()),
    getGlobalChatSettings(database),
  ]);

  return (
    <section className="admin-page">
      <AdminPageHeader
        title="Usage and quotas"
        description="De-identified operational usage and generation capacity."
      />

      <AdminSection title="Current usage">
        <div className="admin-metric-grid">
          <article className="admin-metric-card">
            <h3>UTC day</h3>
            <p>{dashboard.userDay.requests} requests</p>
            <p>
              {tokens(
                dashboard.userDay.inputTokens,
                dashboard.userDay.outputTokens,
              )}
            </p>
          </article>
          <article className="admin-metric-card">
            <h3>UTC month</h3>
            <p>{dashboard.instanceMonth.requests} requests</p>
            <p>
              {tokens(
                dashboard.instanceMonth.inputTokens,
                dashboard.instanceMonth.outputTokens,
              )}
            </p>
          </article>
          <article className="admin-metric-card">
            <h3>Active generations</h3>
            <p>{dashboard.activeGenerations}</p>
          </article>
        </div>
      </AdminSection>

      <AdminSection title="Generation outcomes">
        <ul>
          <li>Complete: {dashboard.outcomes.complete}</li>
          <li>Failed: {dashboard.outcomes.failed}</li>
          <li>Interrupted: {dashboard.outcomes.interrupted}</li>
          <li>Automatic retries: {dashboard.automaticRetries}</li>
          <li>Estimated usage rows: {dashboard.estimatedUsageRows}</li>
          <li>Latency p50: {dashboard.latencyMs.p50 ?? "Unavailable"} ms</li>
          <li>Latency p95: {dashboard.latencyMs.p95 ?? "Unavailable"} ms</li>
        </ul>
      </AdminSection>

      <AdminSection title="Memory background usage">
        <p>
          {tokens(
            dashboard.backgroundWork.inputTokens,
            dashboard.backgroundWork.outputTokens,
          )}
        </p>
        <p>Estimated rows: {dashboard.backgroundWork.estimatedRows}</p>
        <p>
          <a href="/admin/memory">Memory operations</a>
        </p>
      </AdminSection>

      <AdminSection title="Models">
        {dashboard.modelIds.length > 0 ? (
          <ul>
            {dashboard.modelIds.map((modelId) => (
              <li key={modelId}>{modelId}</li>
            ))}
          </ul>
        ) : (
          <p>No usage recorded this month.</p>
        )}
      </AdminSection>

      <AdminSection title="Provider failures">
        <AdminDataList
          ariaLabel="Provider failures"
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
          emptyTitle="No provider failures"
          getRowKey={(failure) => failure.category}
          rows={dashboard.failures}
        />
      </AdminSection>

      <ChatSettingsForm settings={settings} />
    </section>
  );
}
