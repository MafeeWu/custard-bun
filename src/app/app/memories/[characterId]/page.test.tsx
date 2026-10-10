import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { memoryScreenFixture } from "@/test/memory-screen-fixture";
import MemoryPage from "./page";
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  auth: vi.fn(async () => ({ user: { id: "owner" } })),
  missing: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  notFound: mocks.missing,
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/server/auth/require-session", () => ({
  requireSession: mocks.auth,
}));
vi.mock("@/server/db/database", () => ({ getDatabase: async () => ({}) }));
vi.mock("@/server/memory/memory-queries", () => ({
  getRelationshipMemoryScreenView: mocks.get,
}));
vi.mock("../actions", () => ({
  editMemoryAction: vi.fn(),
  deleteMemoryAction: vi.fn(),
  updateMemoryControlsAction: vi.fn(),
  editSummaryAction: vi.fn(),
  regenerateSummaryAction: vi.fn(),
  forgetCharacterAction: vi.fn(),
  retryExtractionAction: vi.fn(),
}));
test("owned character page composes real management forms", async () => {
  mocks.get.mockResolvedValue(memoryScreenFixture());
  render(
    await MemoryPage({
      params: Promise.resolve({ characterId: "character-1" }),
    }),
  );
  expect(mocks.get).toHaveBeenCalledWith(
    {},
    { userId: "owner", characterId: "character-1" },
  );
  expect(
    screen.getByRole("heading", { level: 1, name: "Mira’s memory" }),
  ).toBeVisible();
  expect(screen.getByLabelText("Memory content")).toHaveValue(
    "Likes green tea.",
  );
});
test("wrong owner or missing character is not-found safe", async () => {
  mocks.get.mockResolvedValue(null);
  await expect(
    MemoryPage({ params: Promise.resolve({ characterId: "other-character" }) }),
  ).rejects.toThrow("NOT_FOUND");
});

test("page sends the scoped summary epoch to edit, clear and regeneration forms", async () => {
  mocks.get.mockResolvedValue({ ...memoryScreenFixture(), summaryEpoch: 7 });
  const { container } = render(
    await MemoryPage({
      params: Promise.resolve({ characterId: "character-1" }),
    }),
  );
  expect(
    [...container.querySelectorAll('input[name="expectedMemoryEpoch"]')].map(
      (input) => input.getAttribute("value"),
    ),
  ).toEqual(["7", "7"]);
});
