import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";
import { getPublicConfig } from "@/server/config/public-config";
import "./globals.css";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { branding } = await getPublicConfig();
  return {
    title: branding.name,
    description: branding.description,
    icons: { icon: branding.faviconPath },
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { branding } = await getPublicConfig();
  const style = { "--brand-primary": branding.primaryColor } as CSSProperties;

  return (
    <html lang="en" style={style}>
      <body>{children}</body>
    </html>
  );
}
