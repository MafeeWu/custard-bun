import Link from "next/link";
import { headers } from "next/headers";
import { UserStatusForm } from "@/components/admin/users/user-status-form";
import { requireAdmin } from "@/server/admin/require-admin";
import { listOrdinaryUsers } from "@/server/admin/user-queries";
import { getDatabase } from "@/server/db/database";
import { disableUserAction, restoreUserAction } from "./actions";

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

export default async function AdminUsersPage({ searchParams }: PageProps = {}) {
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
    <section className="page-stack">
      <header>
        <h1>User access</h1>
        <p>Disable or restore ordinary user accounts.</p>
      </header>

      <form action="/admin/users" role="search">
        <label htmlFor="admin-user-search">Search users</label>
        <input
          id="admin-user-search"
          name="q"
          type="search"
          defaultValue={query}
        />
        <button type="submit">Search</button>
      </form>

      {result.users.length === 0 ? <p>No ordinary users found.</p> : null}
      {result.users.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Email</th>
              <th scope="col">Created</th>
              <th scope="col">Status</th>
              <th scope="col">Access</th>
            </tr>
          </thead>
          <tbody>
            {result.users.map((adminUser) => (
              <tr key={adminUser.id}>
                <td>{adminUser.name}</td>
                <td>{adminUser.email}</td>
                <td>{adminUser.createdAt.toISOString()}</td>
                <td>{adminUser.banned ? "Disabled" : "Active"}</td>
                <td>
                  <UserStatusForm
                    user={adminUser}
                    disableAction={disableUserAction.bind(null, adminUser.id)}
                    restoreAction={restoreUserAction.bind(null, adminUser.id)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <nav aria-label="User pagination">
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
