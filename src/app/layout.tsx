import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { createBrandThemeVariables } from "@/server/branding/accent-theme";
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

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { branding } = await getPublicConfig();
  const variables = createBrandThemeVariables(branding.primaryColor);

  return (
    <html
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      lang="en"
      style={variables as CSSProperties}
    >
      <body>{children}</body>
    </html>
  );
}
