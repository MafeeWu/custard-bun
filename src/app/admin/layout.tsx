import { Brain, ChartBar, Chats, ShieldCheck, Users } from "@phosphor-icons/react";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/brand/brand-mark";
import { AdminShell } from "@/components/layout/admin-shell";
import { requireAdmin } from "@/server/admin/require-admin";
import { getPublicConfig } from "@/server/config/public-config";

export const dynamic = "force-dynamic";

const navigationItems = [
  { href: "/admin/characters", icon: Chats, label: "Characters" },
  { href: "/admin/users", icon: Users, label: "Users" },
  { href: "/admin/usage", icon: ChartBar, label: "Usage" },
  { href: "/admin/memory", icon: Brain, label: "Memory operations" },
  { href: "/admin/audit", icon: ShieldCheck, label: "Audit" },
] as const;

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireAdmin(await headers());
  const { branding } = await getPublicConfig();

  return (
    <AdminShell
      brand={<BrandMark branding={branding} />}
      navigationItems={[...navigationItems]}
    >
      {children}
    </AdminShell>
  );
}
