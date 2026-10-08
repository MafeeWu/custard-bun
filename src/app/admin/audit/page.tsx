import Link from "next/link";
import { headers } from "next/headers";
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

export default async function AdminAuditPage({ searchParams }: PageProps = {}) {
  await requireAdmin(await headers());
  const params = (await searchParams) ?? {};
  const page = parsePage(single(params.page));
  const result = await listAdminAuditEvents(await getDatabase(), {
    page,
    pageSize: 50,
  });
  const totalPages = Math.max(1, Math.ceil(result.total / 50));

  return (
    <section className="page-stack">
      <header>
        <h1>Admin audit log</h1>
        <p>Read-only history of administrative operations.</p>
      </header>

      {result.events.length === 0 ? <p>No audit events found.</p> : null}
      {result.events.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Actor</th>
              <th scope="col">Action</th>
              <th scope="col">Target</th>
              <th scope="col">Metadata</th>
              <th scope="col">Operation</th>
            </tr>
          </thead>
          <tbody>
            {result.events.map((event) => (
              <tr
                key={`${event.operationId}-${event.action}-${event.targetId}-${event.createdAt.toISOString()}`}
              >
                <td>{event.createdAt.toISOString()}</td>
                <td>{event.actorLabel}</td>
                <td>{event.action}</td>
                <td>{`${event.targetType}:${event.targetId}`}</td>
                <td>{JSON.stringify(event.metadata)}</td>
                <td>{event.operationId}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <nav aria-label="Audit pagination">
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
