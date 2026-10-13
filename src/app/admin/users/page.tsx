import Link from "next/link";
import { headers } from "next/headers";
import { AdminDataList } from "@/components/admin/admin-data-list";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { UserStatusForm } from "@/components/admin/users/user-status-form";
import { UserQuotaForm } from "@/components/admin/users/user-quota-form";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { requireAdmin } from "@/server/admin/require-admin";
import { listOrdinaryUsers } from "@/server/admin/user-queries";
import { getDatabase } from "@/server/db/database";
import {
  disableUserAction,
  restoreUserAction,
  setUserQuotaAction,
} from "./actions";

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

function usersPageHref(query: string, page: number): string {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  params.set("page", String(page));
  return `/admin/users?${params.toString()}`;
}

export default async function AdminUsersPage({ searchParams }: PageProps) {
  await requireAdmin(await headers());
  const params = (await searchParams) ?? {};
  const query = single(params.q)?.trim() ?? "";
  const page = parsePage(single(params.page));
  const result = await listOrdinaryUsers(await getDatabase(), {
    query,
    page,
    pageSize: 25,
  });
  const totalPages = Math.max(1, Math.ceil(result.total / 25));

  return (
    <section className="admin-page">
      <AdminPageHeader
        title="User access"
        description="Disable or restore ordinary user accounts."
      />

      <form action="/admin/users" className="admin-search-form" role="search">
        <Field htmlFor="admin-user-search" label="Search users">
          <Input
            id="admin-user-search"
            name="q"
            type="search"
            defaultValue={query}
          />
        </Field>
        <Button type="submit" tone="secondary">
          Search
        </Button>
      </form>

      <AdminDataList
        ariaLabel="Ordinary users"
        columns={[
          {
            key: "name",
            header: "Name",
            priority: "primary",
            cell: (user) => user.name,
          },
          {
            key: "email",
            header: "Email",
            priority: "secondary",
            cell: (user) => user.email,
          },
          {
            key: "created",
            header: "Created",
            priority: "detail",
            cell: (user) => user.createdAt.toISOString(),
          },
          {
            key: "status",
            header: "Status",
            priority: "secondary",
            cell: (user) => (
              <span className="admin-status-pill">
                {user.banned ? "Disabled" : "Active"}
              </span>
            ),
          },
          {
            key: "usage",
            header: "Current UTC-day usage",
            priority: "detail",
            cell: (user) =>
              `${user.currentPeriodRequests} requests / ${user.currentPeriodTokens} tokens`,
          },
          {
            key: "quota",
            header: "Quota override",
            priority: "detail",
            cell: (user) => (
              <UserQuotaForm
                user={user}
                action={setUserQuotaAction.bind(null, user.id)}
              />
            ),
          },
          {
            key: "access",
            header: "Access",
            priority: "detail",
            cell: (user) => (
              <UserStatusForm
                user={user}
                disableAction={disableUserAction.bind(null, user.id)}
                restoreAction={restoreUserAction.bind(null, user.id)}
              />
            ),
          },
        ]}
        emptyTitle="No ordinary users found."
        getRowKey={(user) => user.id}
        rows={result.users}
      />

      <nav aria-label="User pagination" className="admin-pagination">
        {page > 1 ? (
          <Link href={usersPageHref(query, page - 1)}>Previous page</Link>
        ) : null}
        <span>
          Page {page} of {totalPages}
        </span>
        {page < totalPages ? (
          <Link href={usersPageHref(query, page + 1)}>Next page</Link>
        ) : null}
      </nav>
    </section>
  );
}
