import Link from "next/link";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { requireAdmin } from "@/server/admin/require-admin";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireAdmin(await headers());

  return (
    <div>
      <nav aria-label="Administration">
        <ul>
          <li>
            <Link href="/admin/characters">Characters</Link>
          </li>
          <li>
            <Link href="/admin/users">Users</Link>
          </li>
          <li>
            <Link href="/admin/usage">Usage</Link>
          </li>
          <li>
            <Link href="/admin/memory">Memory operations</Link>
          </li>
          <li>
            <Link href="/admin/audit">Audit</Link>
          </li>
        </ul>
      </nav>
      <main>{children}</main>
    </div>
  );
}
