import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, expect, test, vi } from "vitest";
import { requireAdmin } from "@/server/admin/require-admin";
import { getPublicConfig } from "@/server/config/public-config";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/server/admin/require-admin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/server/config/public-config", () => ({ getPublicConfig: vi.fn() }));
vi.mock("@/components/brand/brand-mark", () => ({
  BrandMark: ({ branding }: { branding: { name: string } }) => (
    <span>{branding.name}</span>
  ),
}));
vi.mock("@/components/layout/admin-shell", () => ({
  AdminShell: ({
    children,
    navigationItems,
  }: {
    children: ReactNode;
    navigationItems: Array<{ href: string; label: string }>;
  }) => (
    <div>
      <nav aria-label="Administration">
        <ul>
          {navigationItems.map((item) => (
            <li key={item.href}>
              <a href={item.href}>{item.label}</a>
            </li>
          ))}
        </ul>
      </nav>
      <main>{children}</main>
    </div>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdmin).mockResolvedValue({
    userId: "admin",
    label: "admin@example.com",
    operationId: "op",
  });
  vi.mocked(getPublicConfig).mockResolvedValue({
    branding: {
      name: "Custard Bun",
      description: "Private conversations with official characters.",
      logoPath: "/logo.svg",
      faviconPath: "/favicon.ico",
      primaryColor: "#f59e0b",
    },
    registration: {
      open: true,
      maxAttemptsPerHourPerIp: 5,
    },
    links: {
      privacyUrl: "https://example.com/privacy",
      termsUrl: "https://example.com/terms",
      supportUrl: "https://example.com/support",
    },
    chat: {
      firstTokenTimeoutMs: 1_000,
      requestTimeoutMs: 2_000,
      promptTokenBudget: 2_048,
      maxInputCharacters: 5_000,
      maxOutputTokens: 512,
      defaultUserDailyRequestLimit: 10,
      defaultUserDailyTokenLimit: 1000,
      defaultInstanceMonthlyRequestLimit: 100,
      defaultInstanceMonthlyTokenBudget: 10_000,
      maxConcurrentGenerations: 2,
    },
    memory: {
      enabled: true,
      promptTokenBudget: 1_024,
      relationshipSummaryTokenBudget: 256,
      memoryItemsTokenBudget: 512,
      maxActiveItemsPerCharacter: 20,
      maxItemCharacters: 200,
      maxSummaryCharacters: 1_000,
      extractionRetryLimit: 3,
      extractionRetryDelaySeconds: 60,
      exportRetentionHours: 24,
      maxExportArchiveBytes: 100_000,
    },
  });
});

test(
  "includes the aggregate usage administration link",
  async () => {
    const Layout = (await import("./layout")).default;
    render(await Layout({ children: <p>content</p> }));

    expect(
      screen.getByRole("navigation", { name: /administration/i }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Characters" })).toHaveAttribute(
      "href",
      "/admin/characters",
    );
    expect(screen.getByRole("link", { name: "Users" })).toHaveAttribute(
      "href",
      "/admin/users",
    );
    expect(screen.getByRole("link", { name: "Usage" })).toHaveAttribute(
      "href",
      "/admin/usage",
    );
    expect(
      screen.getByRole("link", { name: "Memory operations" }),
    ).toHaveAttribute("href", "/admin/memory");
    expect(screen.getByRole("link", { name: "Audit" })).toHaveAttribute(
      "href",
      "/admin/audit",
    );
  },
  15_000,
);
