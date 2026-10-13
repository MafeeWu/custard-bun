import Link from "next/link";
import { headers } from "next/headers";
import { AdminDataList } from "@/components/admin/admin-data-list";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { requireAdmin } from "@/server/admin/require-admin";
import { listAdminAuditEvents } from "@/server/admin/audit-queries";
import { getDatabase } from "@/server/db/database";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parsePage(value: string | undefined): number {
  const parsed = Number(value ?? "1");
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function auditPageHref(page: number): string {
  const params = new URLSearchParams({ page: String(page) });
  return `/admin/audit?${params.toString()}`;
}

const visibleMetadataKeys = new Set([
  "archived",
  "changedFields",
  "dailyRequestLimit",
  "dailyTokenLimit",
  "enabled",
  "instanceMonthlyRequestLimit",
  "instanceMonthlyTokenBudget",
  "maxConcurrentGenerations",
  "memoryEpoch",
  "newVersionNumber",
  "nextRevision",
  "nextState",
  "operationId",
  "operationType",
  "previousDailyRequestLimit",
  "previousDailyTokenLimit",
  "previousEnabled",
  "previousRevision",
  "previousState",
  "previousVersionNumber",
  "revision",
  "slug",
  "userDailyRequestLimit",
  "userDailyTokenLimit",
  "versionNumber",
]);

function metadataSummary(
  metadata: Record<string, string | number | boolean | null>,
) {
  const safe = Object.fromEntries(
    Object.entries(metadata).filter(([key]) => visibleMetadataKeys.has(key)),
  );
  return JSON.stringify(safe);
}

export default async function AdminAuditPage({ searchParams }: PageProps) {
  await requireAdmin(await headers());
  const params = (await searchParams) ?? {};
  const page = parsePage(single(params.page));
  const result = await listAdminAuditEvents(await getDatabase(), {
    page,
    pageSize: 50,
  });
  const totalPages = Math.max(1, Math.ceil(result.total / 50));

  return (
    <section className="admin-page">
      <AdminPageHeader
        title="Admin audit log"
        description="Read-only history of administrative operations."
      />

      <AdminDataList
        ariaLabel="Admin audit log"
        columns={[
          {
            key: "time",
            header: "Time",
            priority: "secondary",
            cell: (event) => event.createdAt.toISOString(),
          },
          {
            key: "actor",
            header: "Actor",
            priority: "secondary",
            cell: (event) => event.actorLabel,
          },
          {
            key: "action",
            header: "Action",
            priority: "primary",
            cell: (event) => event.action,
          },
          {
            key: "target",
            header: "Target",
            priority: "secondary",
            cell: (event) => `${event.targetType}:${event.targetId}`,
          },
          {
            key: "metadata",
            header: "Metadata",
            priority: "detail",
            cell: (event) => metadataSummary(event.metadata),
          },
          {
            key: "operation",
            header: "Operation",
            priority: "detail",
            cell: (event) => event.operationId,
          },
        ]}
        emptyTitle="No audit events found."
        getRowKey={(event) =>
          `${event.operationId}-${event.action}-${event.targetId}-${event.createdAt.toISOString()}`
        }
        rows={result.events}
      />

      <nav aria-label="Audit pagination" className="admin-pagination">
        {page > 1 ? (
          <Link href={auditPageHref(page - 1)}>Previous page</Link>
        ) : null}
        <span>
          Page {page} of {totalPages}
        </span>
        {page < totalPages ? (
          <Link href={auditPageHref(page + 1)}>Next page</Link>
        ) : null}
      </nav>
    </section>
  );
}
