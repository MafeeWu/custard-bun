import { Brain, Chats, UserCircle } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/brand/brand-mark";
import { AppShell } from "@/components/layout/app-shell";
import { getPublicConfig } from "@/server/config/public-config";

export const dynamic = "force-dynamic";

const navigationItems = [
  { href: "/app", icon: Chats, label: "Conversations" },
  { href: "/app/memories", icon: Brain, label: "Memories" },
  { href: "/account", icon: UserCircle, label: "Account" },
] as const;

export default async function ApplicationLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { branding } = await getPublicConfig();

  return (
    <AppShell
      brand={<BrandMark branding={branding} />}
      navigationItems={[...navigationItems]}
    >
      {children}
    </AppShell>
  );
}
