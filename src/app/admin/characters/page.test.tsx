import { render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { requireAdmin } from "@/server/admin/require-admin";
import {
  getAdminCharacterEditorDetail,
  listAdminCharacters,
} from "@/server/characters/character-queries";

type FormAction = (
  state: { status: "idle" },
  formData: FormData,
) => Promise<unknown>;

type CharacterEditorProps = {
  publishAction: FormAction;
};

type VersionHistoryProps = {
  setDefaultAction: FormAction;
  archiveAction: FormAction;
  restoreAction: FormAction;
};

const editPageMocks = vi.hoisted(() => ({
  CharacterEditor: vi.fn((props: CharacterEditorProps) => {
    void props;
    return null;
  }),
  VersionHistory: vi.fn((props: VersionHistoryProps) => {
    void props;
    return null;
  }),
  publishCharacterDraftAction: vi.fn(),
  setDefaultCharacterVersionAction: vi.fn(),
  archiveCharacterAction: vi.fn(),
  restoreCharacterAction: vi.fn(),
  saveCharacterDraftAction: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/server/admin/require-admin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/server/db/database", () => ({
  getDatabase: async () => ({ db: true }),
}));
vi.mock("@/server/characters/character-queries", () => ({
  listAdminCharacters: vi.fn(),
  getAdminCharacterEditorDetail: vi.fn(),
}));
vi.mock("@/components/admin/characters/character-editor", () => ({
  CharacterEditor: editPageMocks.CharacterEditor,
}));
vi.mock("@/components/admin/characters/version-history", () => ({
  VersionHistory: editPageMocks.VersionHistory,
}));
vi.mock("./actions", () => ({
  createCharacterAction: vi.fn(),
  saveCharacterDraftAction: editPageMocks.saveCharacterDraftAction,
  publishCharacterDraftAction: editPageMocks.publishCharacterDraftAction,
  setDefaultCharacterVersionAction: editPageMocks.setDefaultCharacterVersionAction,
  archiveCharacterAction: editPageMocks.archiveCharacterAction,
  restoreCharacterAction: editPageMocks.restoreCharacterAction,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

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

test("edit page returns publish, default, archive, and restore action states to explicit forms", async () => {
  vi.mocked(requireAdmin).mockResolvedValue({
    userId: "admin",
    label: "admin@example.com",
    operationId: "op",
  });
  vi.mocked(getAdminCharacterEditorDetail).mockResolvedValue({
    id: "char-1",
    slug: "calm-guide",
    lifecycle: "active",
    defaultVersionId: "version-1",
    draftRevision: 3,
    draft: {
      displayName: "Calm Guide",
      avatarPath: "/characters/calm-listener.svg",
      shortDescription: "A steady companion.",
      longDescription: "A patient companion.",
      personalityPrinciples: ["Reflect first."],
      speakingStyle: "Warm.",
      responseRhythm: "Steady.",
      relationshipBoundaries: ["Stay bounded."],
      openingMessage: "Hello.",
      exampleConversations: [{ user: "Hi", assistant: "Hello" }],
      generationParameters: {
        temperature: 0.6,
        topP: 0.9,
        maxOutputTokens: 700,
      },
      safetyAdditions: [],
    },
    versions: [
      {
        id: "version-1",
        versionNumber: 1,
        displayName: "Calm Guide",
        publishedAt: new Date("2026-10-08T01:02:03Z"),
      },
    ],
  } as never);
  editPageMocks.publishCharacterDraftAction.mockResolvedValue({
    status: "error",
    message:
      "This draft changed in another session. Reload the page before editing again.",
  });
  editPageMocks.setDefaultCharacterVersionAction.mockResolvedValue({
    status: "error",
    message: "Default version could not be changed.",
  });
  editPageMocks.archiveCharacterAction.mockResolvedValue({
    status: "error",
    message: "Character could not be archived.",
  });
  editPageMocks.restoreCharacterAction.mockResolvedValue({
    status: "error",
    message: "Character could not be restored.",
  });
  const Page = (await import("./[id]/page")).default;
  const formData = new FormData();
  const state = { status: "idle" as const };

  render(await Page({ params: Promise.resolve({ id: "char-1" }) }));

  const editorProps = editPageMocks.CharacterEditor.mock.calls[0]![0];
  const historyProps = editPageMocks.VersionHistory.mock.calls[0]![0];
  await expect(editorProps.publishAction(state, formData)).resolves.toEqual({
    status: "error",
    message:
      "This draft changed in another session. Reload the page before editing again.",
  });
  await expect(historyProps.setDefaultAction(state, formData)).resolves.toEqual({
    status: "error",
    message: "Default version could not be changed.",
  });
  await expect(historyProps.archiveAction(state, formData)).resolves.toEqual({
    status: "error",
    message: "Character could not be archived.",
  });
  await expect(historyProps.restoreAction(state, formData)).resolves.toEqual({
    status: "error",
    message: "Character could not be restored.",
  });
});
