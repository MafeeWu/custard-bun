import { beforeEach, describe, expect, test, vi } from "vitest";
import { DraftConflictError } from "@/server/characters/character-errors";
import { createCharacterService } from "@/server/characters/character-service";
import { getDatabase } from "@/server/db/database";
import { requireAdmin } from "@/server/admin/require-admin";

const redirectError = new Error("NEXT_REDIRECT");
const revalidatePath = vi.fn();
const redirect = vi.fn(() => {
  throw redirectError;
});
const service = {
  createCharacter: vi.fn(),
  saveDraft: vi.fn(),
  publishDraft: vi.fn(),
  setDefaultVersion: vi.fn(),
  setArchived: vi.fn(),
};

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers([["cookie", "session=1"]]),
}));
vi.mock("@/server/admin/require-admin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/server/db/database", () => ({ getDatabase: vi.fn() }));
vi.mock("@/server/characters/character-service", () => ({
  createCharacterService: vi.fn(),
}));

function validFormData(overrides: Record<string, string | string[]> = {}) {
  const values: Record<string, string | string[]> = {
    actorUserId: "forged-admin",
    slug: "calm-guide",
    expectedRevision: "3",
    displayName: "Calm Guide",
    avatarPath: "/characters/calm-listener.svg",
    shortDescription: "A steady companion.",
    longDescription: "A patient companion for reflective conversations.",
    personalityPrinciples: "Reflect first.",
    speakingStyle: "Warm and concise.",
    responseRhythm: "Pause, reflect, then ask.",
    relationshipBoundaries: "Do not claim to be human.",
    openingMessage: "What feels most important right now?",
    exampleUser: ["I feel stuck."],
    exampleAssistant: ["Let's name what feels stuck first."],
    temperature: "0.6",
    topP: "0.9",
    maxOutputTokens: "700",
    safetyAdditions: "Suggest emergency help for immediate danger.",
  };
  const data = new FormData();
  for (const [key, value] of Object.entries({ ...values, ...overrides })) {
    if (Array.isArray(value)) value.forEach((entry) => data.append(key, entry));
    else data.set(key, value);
  }
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdmin).mockResolvedValue({
    userId: "real-admin",
    label: "real@example.com",
    operationId: "op-1",
  });
  vi.mocked(getDatabase).mockResolvedValue({ db: true } as never);
  vi.mocked(createCharacterService).mockReturnValue(service as never);
});

describe("character admin actions", () => {
  test("creates with the required admin actor, revalidates admin paths, and redirects only after success", async () => {
    service.createCharacter.mockResolvedValue({
      characterId: "char-1",
      draftRevision: 1,
    });
    const { createCharacterAction } = await import("./actions");

    await expect(
      createCharacterAction({ status: "idle" }, validFormData()),
    ).rejects.toBe(redirectError);

    expect(createCharacterService).toHaveBeenCalledWith({
      database: { db: true },
      actor: {
        userId: "real-admin",
        label: "real@example.com",
        operationId: "op-1",
      },
    });
    expect(service.createCharacter).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "calm-guide" }),
    );
    expect(
      JSON.stringify(service.createCharacter.mock.calls[0][0]),
    ).not.toContain("forged-admin");
    expect(revalidatePath).toHaveBeenCalledWith("/admin/characters");
    expect(revalidatePath).toHaveBeenCalledWith("/admin/characters/char-1");
    expect(redirect).toHaveBeenCalledWith("/admin/characters/char-1");
  });

  test("requires admin and returns field errors without mutating for invalid form data", async () => {
    const { saveCharacterDraftAction } = await import("./actions");

    const result = await saveCharacterDraftAction(
      "char-1",
      { status: "idle" },
      validFormData({ temperature: "hot" }),
    );

    expect(result).toEqual({
      status: "error",
      message: "Check the highlighted fields and try again.",
      fieldErrors: { temperature: ["Temperature must be a valid number."] },
    });
    expect(requireAdmin).toHaveBeenCalled();
    expect(createCharacterService).toHaveBeenCalled();
    expect(service.saveDraft).not.toHaveBeenCalled();
  });

  test("saves draft with expected revision and maps draft conflicts to reload guidance", async () => {
    service.saveDraft.mockRejectedValue(new DraftConflictError());
    const { saveCharacterDraftAction } = await import("./actions");

    const result = await saveCharacterDraftAction(
      "char-1",
      { status: "idle" },
      validFormData({ expectedRevision: "5" }),
    );

    expect(service.saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({ characterId: "char-1", expectedRevision: 5 }),
    );
    expect(result).toEqual({
      status: "error",
      message:
        "This draft changed in another session. Reload the page before editing again.",
    });
  });

  test("publishes, defaults, archives, and restores without hidden side effects and revalidates public paths", async () => {
    const actions = await import("./actions");
    service.publishDraft.mockResolvedValue({
      versionId: "version-1",
      versionNumber: 2,
      draftRevision: 6,
    });
    service.setDefaultVersion.mockResolvedValue(undefined);
    service.setArchived.mockResolvedValue(undefined);

    await expect(
      actions.publishCharacterDraftAction(
        "char-1",
        "calm-guide",
        { status: "idle" },
        validFormData({ expectedRevision: "5" }),
      ),
    ).resolves.toEqual({
      status: "success",
      message: "Published version 2.",
      draftRevision: 6,
    });
    await expect(
      actions.setDefaultCharacterVersionAction(
        "char-1",
        "calm-guide",
        { status: "idle" },
        validFormData({ versionId: "version-1" }),
      ),
    ).resolves.toEqual({
      status: "success",
      message: "Default version updated.",
    });
    await expect(
      actions.archiveCharacterAction(
        "char-1",
        "calm-guide",
        { status: "idle" },
        new FormData(),
      ),
    ).resolves.toEqual({ status: "success", message: "Character archived." });
    await expect(
      actions.restoreCharacterAction(
        "char-1",
        "calm-guide",
        { status: "idle" },
        new FormData(),
      ),
    ).resolves.toEqual({ status: "success", message: "Character restored." });

    expect(service.publishDraft).toHaveBeenCalledWith({
      characterId: "char-1",
      expectedRevision: 5,
    });
    expect(service.setDefaultVersion).toHaveBeenCalledWith({
      characterId: "char-1",
      versionId: "version-1",
    });
    expect(service.setArchived).toHaveBeenCalledWith({
      characterId: "char-1",
      archived: true,
    });
    expect(service.setArchived).toHaveBeenCalledWith({
      characterId: "char-1",
      archived: false,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/characters");
    expect(revalidatePath).toHaveBeenCalledWith("/characters/calm-guide");
  });

  test("never reports success after a service error", async () => {
    service.publishDraft.mockRejectedValue(new Error("database down"));
    const { publishCharacterDraftAction } = await import("./actions");

    const result = await publishCharacterDraftAction(
      "char-1",
      "calm-guide",
      { status: "idle" },
      validFormData(),
    );

    expect(result.status).toBe("error");
    expect(result.message).toBe("Unable to update the character. Try again.");
    expect(redirect).not.toHaveBeenCalled();
  });

  test("returns the confirmed revision on a successful save", async () => {
    service.saveDraft.mockResolvedValue({ draftRevision: 4 });
    const { saveCharacterDraftAction } = await import("./actions");

    await expect(
      saveCharacterDraftAction("char-1", { status: "idle" }, validFormData()),
    ).resolves.toEqual({
      status: "success",
      message: "Saved draft revision 4.",
      draftRevision: 4,
    });
  });
});
