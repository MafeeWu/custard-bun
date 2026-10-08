import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { requireAdmin } from "@/server/admin/require-admin";
import { listAdminCharacters } from "@/server/characters/character-queries";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/server/admin/require-admin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/server/db/database", () => ({
  getDatabase: async () => ({ db: true }),
}));
vi.mock("@/server/characters/character-queries", () => ({
  listAdminCharacters: vi.fn(),
}));

test("renders character administration list state badges and links", async () => {
  vi.mocked(requireAdmin).mockResolvedValue({
    userId: "admin",
    label: "admin@example.com",
    operationId: "op",
  });
  vi.mocked(listAdminCharacters).mockResolvedValue([
    {
      id: "char-1",
      slug: "calm-guide",
      lifecycle: "active",
      displayName: "Calm Guide",
      draftRevision: 3,
      baseVersionNumber: 2,
      defaultVersionNumber: 1,
      latestVersionNumber: 2,
    },
    {
      id: "char-2",
      slug: "archived-guide",
      lifecycle: "archived",
      displayName: "Archived Guide",
      draftRevision: 1,
      baseVersionNumber: null,
      defaultVersionNumber: null,
      latestVersionNumber: null,
    },
  ] as never);
  const Page = (await import("./page")).default;

  render(await Page());

  expect(
    screen.getByRole("heading", { level: 1, name: "Official characters" }),
  ).toBeVisible();
  expect(
    screen.getByRole("link", { name: "Create character" }),
  ).toHaveAttribute("href", "/admin/characters/new");
  expect(screen.getByRole("link", { name: "Calm Guide" })).toHaveAttribute(
    "href",
    "/admin/characters/char-1",
  );
  expect(screen.getByText("active")).toBeVisible();
  expect(screen.getByText("archived")).toBeVisible();
  expect(
    screen.getByText("Draft r3 · base v2 · default v1 · latest v2"),
  ).toBeVisible();
});
