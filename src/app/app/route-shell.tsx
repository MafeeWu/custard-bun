import { Brain, Chats, UserCircle } from "@phosphor-icons/react/ssr";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/brand/brand-mark";
import { AppShell } from "@/components/layout/app-shell";
import { FocusedChatShell } from "@/components/layout/focused-chat-shell";
import { getPublicConfig } from "@/server/config/public-config";
import type { PublicAppConfig } from "@/server/config/schema";

const navigationItems = [
  { href: "/app", icon: Chats, label: "Conversations" },
  { href: "/app/memories", icon: Brain, label: "Memories" },
  { href: "/account", icon: UserCircle, label: "Account" },
] as const;

type Branding = PublicAppConfig["branding"];

async function resolveBranding(branding?: Branding) {
  if (branding) {
    return branding;
  }
  return (await getPublicConfig()).branding;
}

export async function renderApplicationRouteShell(
  children: ReactNode,
  branding?: Branding,
) {
  const resolvedBranding = await resolveBranding(branding);

  return (
    <AppShell
      brand={<BrandMark branding={resolvedBranding} />}
      navigationItems={[...navigationItems]}
    >
      {children}
    </AppShell>
  );
}

export async function renderFocusedChatRouteShell(children: ReactNode) {
  const branding = await resolveBranding();

  return (
    <FocusedChatShell
      brand={<BrandMark branding={branding} />}
      navigationItems={[...navigationItems]}
    >
      {children}
    </FocusedChatShell>
  );
}
