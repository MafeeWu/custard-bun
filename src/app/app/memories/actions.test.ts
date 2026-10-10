import { beforeEach, expect, test, vi } from "vitest";
import { MemoryDomainError } from "@/server/memory/memory-errors";
import * as actions from "./actions";

const mocks = vi.hoisted(() => ({
  headers: new Headers([["cookie", "session=owned"]]),
  requireSession: vi.fn(async () => ({ user: { id: "owner" } })),
  revalidatePath: vi.fn(),
  controls: vi.fn(),
  edit: vi.fn(),
  remove: vi.fn(),
  forget: vi.fn(),
  summary: vi.fn(),
  regenerate: vi.fn(),
  retry: vi.fn(),
  conversations: vi.fn(async () => [
    { id: "owned-chat", character: { id: "character-1" } },
  ]),
  relationships: vi.fn(async () => [{ character: { id: "character-1" } }]),
}));
vi.mock("next/headers", () => ({ headers: async () => mocks.headers }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/server/auth/require-session", () => ({
  requireSession: mocks.requireSession,
}));
vi.mock("@/server/db/database", () => ({ getDatabase: async () => ({}) }));
vi.mock("@/server/chat/conversation-queries", () => ({
  listActiveConversations: mocks.conversations,
}));
vi.mock("@/server/memory/memory-queries", () => ({
  listMemoryRelationships: mocks.relationships,
}));
vi.mock("@/server/memory/memory-service", () => ({
  updateMemoryControls: mocks.controls,
  editMemoryItem: mocks.edit,
  deleteMemoryItem: mocks.remove,
  forgetCharacter: mocks.forget,
}));
vi.mock("@/server/memory/relationship-summary-service", () => ({
  editRelationshipSummary: mocks.summary,
  requestSummaryRegeneration: mocks.regenerate,
}));
vi.mock("@/server/memory/memory-extraction-service", () => ({
  retryMemoryExtraction: mocks.retry,
}));
beforeEach(() => {
  for (const fn of [
    mocks.controls,
    mocks.edit,
    mocks.remove,
    mocks.forget,
    mocks.summary,
  ])
    fn.mockResolvedValue({ revision: 3 });
});
function form() {
  const data = new FormData();
  data.set("expectedRevision", "2");
  data.set("memoryId", "memory-1");
  data.set("content", "My edit");
  data.set("runId", "run-1");
  data.set("confirm", "on");
  data.set("explicitIntent", "on");
  return data;
}
test.each([
  ["editMemoryAction", "edit"],
  ["deleteMemoryAction", "remove"],
  ["updateMemoryControlsAction", "controls"],
  ["editSummaryAction", "summary"],
  ["forgetCharacterAction", "forget"],
  ["retryExtractionAction", "retry"],
  ["regenerateSummaryAction", "regenerate"],
] as const)(
  "%s authenticates and revalidates only owned routes",
  async (action, service) => {
    const result = await actions[action](
      "character-1",
      { status: "idle" },
      form(),
    );
    expect(mocks.requireSession).toHaveBeenCalledWith(mocks.headers);
    expect(mocks[service]).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ userId: "owner", characterId: "character-1" }),
    );
    expect(result.status).toBe("success");
    for (const route of [
      "/app/memories",
      "/app/memories/character-1",
      "/app",
      "/account",
      "/app/conversations/owned-chat",
    ])
      expect(mocks.revalidatePath).toHaveBeenCalledWith(route);
  },
);
test("controls submit independent recording and usage values and revision", async () => {
  const data = form();
  data.set("stopRecording", "on");
  await actions.updateMemoryControlsAction(
    "character-1",
    { status: "idle" },
    data,
  );
  expect(mocks.controls).toHaveBeenCalledWith(
    {},
    {
      userId: "owner",
      characterId: "character-1",
      expectedRevision: 2,
      recordingEnabled: false,
      usageEnabled: true,
    },
  );
});
test("edits forward explicit manual intent, identity and optimistic revision", async () => {
  await actions.editMemoryAction("character-1", { status: "idle" }, form());
  expect(mocks.edit).toHaveBeenCalledWith(
    {},
    {
      userId: "owner",
      characterId: "character-1",
      memoryId: "memory-1",
      expectedRevision: 2,
      content: "My edit",
      userExplicitlyAskedToRemember: true,
    },
  );
});
test("conflicts refresh authoritative routes without echoing content or metadata", async () => {
  mocks.edit.mockRejectedValue(
    new MemoryDomainError("MEMORY_REVISION_CONFLICT", "private content", {
      metadata: { actualRevision: 7, providerIdentity: "secret" },
    }),
  );
  expect(
    await actions.editMemoryAction("character-1", { status: "idle" }, form()),
  ).toEqual({
    status: "conflict",
    message:
      "Memory changed since it was loaded. Your draft is preserved. Review the refreshed version before saving again.",
  });
  expect(mocks.revalidatePath).toHaveBeenCalledWith(
    "/app/memories/character-1",
  );
});
test.each([
  "MEMORY_NOT_FOUND",
  "MEMORY_VALIDATION",
  "MEMORY_INTERNAL",
] as const)("safe %s errors never expose content", async (code) => {
  mocks.edit.mockRejectedValue(
    new MemoryDomainError(code, "private transcript/provider"),
  );
  const result = await actions.editMemoryAction(
    "character-1",
    { status: "idle" },
    form(),
  );
  expect(result.status).toBe("error");
  expect(JSON.stringify(result)).not.toMatch(/private|provider/);
});
test("unexpected failures are fixed safe copy", async () => {
  mocks.edit.mockRejectedValue(new Error("deleted transcript"));
  expect(
    await actions.editMemoryAction("character-1", { status: "idle" }, form()),
  ).toEqual({
    status: "error",
    message: "Unable to change memory. Try again.",
  });
});
test("invalid revisions and unconfirmed destructive actions do not mutate", async () => {
  const data = form();
  data.set("expectedRevision", "NaN");
  expect(
    (await actions.editMemoryAction("character-1", { status: "idle" }, data))
      .status,
  ).toBe("error");
  data.delete("confirm");
  expect(
    (
      await actions.forgetCharacterAction(
        "character-1",
        { status: "idle" },
        data,
      )
    ).status,
  ).toBe("error");
  expect(
    (await actions.deleteMemoryAction("character-1", { status: "idle" }, data))
      .status,
  ).toBe("error");
  expect(mocks.edit).not.toHaveBeenCalled();
  expect(mocks.forget).not.toHaveBeenCalled();
  expect(mocks.remove).not.toHaveBeenCalled();
});
test("clear summary uses the service revision with empty content", async () => {
  const data = form();
  data.set("operation", "clear");
  await actions.editSummaryAction("character-1", { status: "idle" }, data);
  expect(mocks.summary).toHaveBeenCalledWith(
    {},
    {
      userId: "owner",
      characterId: "character-1",
      expectedRevision: 2,
      content: "",
    },
  );
});
test("actions reject missing or wrong-owner character relationships without mutating", async () => {
  mocks.relationships.mockResolvedValueOnce([]);
  expect(
    await actions.forgetCharacterAction(
      "character-other",
      { status: "idle" },
      form(),
    ),
  ).toEqual({
    status: "error",
    message: "The requested memory was not found.",
  });
  expect(mocks.forget).not.toHaveBeenCalled();
});
test("summary edits without explicit intent cannot reach the service", async () => {
  const data = form();
  data.delete("explicitIntent");
  expect(
    (await actions.editSummaryAction("character-1", { status: "idle" }, data))
      .status,
  ).toBe("error");
  expect(mocks.summary).not.toHaveBeenCalled();
});
test("unauthenticated actions stop at the existing session boundary", async () => {
  const authError = new Error("AUTH_REQUIRED");
  mocks.requireSession.mockRejectedValueOnce(authError);
  await expect(
    actions.editMemoryAction("character-1", { status: "idle" }, form()),
  ).rejects.toBe(authError);
  expect(mocks.edit).not.toHaveBeenCalled();
  expect(mocks.relationships).not.toHaveBeenCalled();
});
