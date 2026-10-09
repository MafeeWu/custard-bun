import { headers } from "next/headers";
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
    <section className="page-stack">
      <header>
        <h1>Usage and quotas</h1>
        <p>De-identified operational usage and generation capacity.</p>
      </header>

      <section aria-labelledby="current-usage-heading">
        <h2 id="current-usage-heading">Current usage</h2>
        <article>
          <h3>UTC day</h3>
          <p>{dashboard.userDay.requests} requests</p>
          <p>
            {tokens(
              dashboard.userDay.inputTokens,
              dashboard.userDay.outputTokens,
            )}
          </p>
        </article>
        <article>
          <h3>UTC month</h3>
          <p>{dashboard.instanceMonth.requests} requests</p>
          <p>
            {tokens(
              dashboard.instanceMonth.inputTokens,
              dashboard.instanceMonth.outputTokens,
            )}
          </p>
        </article>
        <article>
          <h3>Active generations</h3>
          <p>{dashboard.activeGenerations}</p>
        </article>
      </section>

      <section aria-labelledby="outcomes-heading">
        <h2 id="outcomes-heading">Generation outcomes</h2>
        <ul>
          <li>Complete: {dashboard.outcomes.complete}</li>
          <li>Failed: {dashboard.outcomes.failed}</li>
          <li>Interrupted: {dashboard.outcomes.interrupted}</li>
          <li>Automatic retries: {dashboard.automaticRetries}</li>
          <li>Estimated usage rows: {dashboard.estimatedUsageRows}</li>
          <li>Latency p50: {dashboard.latencyMs.p50 ?? "Unavailable"} ms</li>
          <li>Latency p95: {dashboard.latencyMs.p95 ?? "Unavailable"} ms</li>
        </ul>
      </section>

      <section aria-labelledby="models-heading">
        <h2 id="models-heading">Models</h2>
        {dashboard.modelIds.length > 0 ? (
          <ul>
            {dashboard.modelIds.map((modelId) => (
              <li key={modelId}>{modelId}</li>
            ))}
          </ul>
        ) : (
          <p>No usage recorded this month.</p>
        )}
      </section>

      <section aria-labelledby="failures-heading">
        <h2 id="failures-heading">Provider failures</h2>
        <table aria-label="Provider failures">
          <thead>
            <tr>
              <th scope="col">Category</th>
              <th scope="col">Count</th>
            </tr>
          </thead>
          <tbody>
            {dashboard.failures.map((failure) => (
              <tr key={failure.category}>
                <td>{failure.category}</td>
                <td>{failure.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <ChatSettingsForm settings={settings} />
    </section>
  );
}
