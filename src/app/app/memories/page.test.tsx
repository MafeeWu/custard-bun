import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import MemoryPage from "./page";
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  auth: vi.fn(async () => ({ user: { id: "owner" } })),
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/server/auth/require-session", () => ({
  requireSession: mocks.auth,
}));
vi.mock("@/server/db/database", () => ({ getDatabase: async () => ({}) }));
vi.mock("@/server/config/public-config", () => ({
  getPublicConfig: vi.fn(async () => ({
    branding: {
      name: "Custard Bun",
      description: "Private conversations with consistent AI characters.",
      logoPath: "/brand/logo.svg",
      faviconPath: "/brand/favicon.svg",
      primaryColor: "#F59E0B",
    },
  })),
}));
vi.mock("@/server/memory/memory-queries", () => ({
  listMemoryRelationships: mocks.list,
}));
test("privacy overview renders only owner-scoped relationships without operational data", async () => {
  mocks.list.mockResolvedValue([
    {
      character: { id: "character-1", displayName: "Mira" },
      itemCount: 2,
      recordingEnabled: false,
      usageEnabled: true,
    },
  ]);
  render(await MemoryPage());
  expect(mocks.list).toHaveBeenCalledWith({}, "owner");
  expect(screen.getByRole("link", { name: /Mira/ })).toHaveAttribute(
    "href",
    "/app/memories/character-1",
  );
  expect(screen.getByText(/Recording stopped/)).toBeVisible();
  expect(screen.getByText(/2 memories/)).toBeVisible();
  expect(
    screen.getByRole("complementary", { name: "Application navigation" }),
  ).toBeVisible();
});
test("empty overview explains where relationships appear", async () => {
  mocks.list.mockResolvedValue([]);
  render(await MemoryPage());
  expect(screen.getByText(/Start a conversation/)).toBeVisible();
});
