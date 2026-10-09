import { beforeEach, describe, expect, test, vi } from "vitest";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/server/admin/require-admin";
import {
  ChatSettingsAdminError,
  resetGlobalChatSettings,
  updateGlobalChatSettings,
} from "@/server/admin/chat-settings-service";
import { getDatabase } from "@/server/db/database";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers([["cookie", "session=1"]]),
}));
vi.mock("@/server/admin/require-admin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/server/db/database", () => ({ getDatabase: vi.fn() }));
vi.mock("@/server/admin/chat-settings-service", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("@/server/admin/chat-settings-service")
    >();
  return {
    ...original,
    resetGlobalChatSettings: vi.fn(),
    updateGlobalChatSettings: vi.fn(),
  };
});

const actor = {
  userId: "admin-1",
  label: "admin@example.com",
  operationId: "op-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdmin).mockResolvedValue(actor);
  vi.mocked(getDatabase).mockResolvedValue({ db: true } as never);
});

function validFormData() {
  const formData = new FormData();
  formData.set("expectedRevision", "3");
  formData.set("userDailyRequestLimit", "100");
  formData.set("userDailyTokenLimit", "10000");
  formData.set("instanceMonthlyRequestLimit", "1000");
  formData.set("instanceMonthlyTokenBudget", "100000");
  formData.set("maxConcurrentGenerations", "4");
  return formData;
}

describe("usage administration actions", () => {
  test("updates settings and revalidates both administration surfaces", async () => {
    vi.mocked(updateGlobalChatSettings).mockResolvedValue({ revision: 4 });
    const { updateGlobalChatSettingsAction } = await import("./actions");
    const formData = validFormData();

    await expect(
      updateGlobalChatSettingsAction({ status: "idle" }, formData),
    ).resolves.toMatchObject({
      status: "success",
      message: "Chat settings updated.",
      values: { expectedRevision: "4" },
    });
    expect(updateGlobalChatSettings).toHaveBeenCalledWith({ db: true }, actor, {
      expectedRevision: 3,
      userDailyRequestLimit: 100,
      userDailyTokenLimit: 10_000,
      instanceMonthlyRequestLimit: 1_000,
      instanceMonthlyTokenBudget: 100_000,
      maxConcurrentGenerations: 4,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/admin/usage");
    expect(revalidatePath).toHaveBeenCalledWith("/admin/users");
  });

  test("preserves submitted values on validation and conflict errors", async () => {
    const { updateGlobalChatSettingsAction } = await import("./actions");
    const invalid = validFormData();
    invalid.set("userDailyRequestLimit", "not-a-number");
    await expect(
      updateGlobalChatSettingsAction({ status: "idle" }, invalid),
    ).resolves.toMatchObject({
      status: "error",
      values: { userDailyRequestLimit: "not-a-number" },
    });
    expect(updateGlobalChatSettings).not.toHaveBeenCalled();

    vi.mocked(updateGlobalChatSettings).mockRejectedValue(
      new ChatSettingsAdminError(
        "SETTINGS_CONFLICT",
        "Chat settings changed in another session",
      ),
    );
    const conflict = validFormData();
    conflict.set("userDailyTokenLimit", "7777");
    await expect(
      updateGlobalChatSettingsAction({ status: "idle" }, conflict),
    ).resolves.toMatchObject({
      status: "error",
      message:
        "These settings changed in another session. Reload before trying again.",
      values: { userDailyTokenLimit: "7777" },
    });
  });

  test("requires explicit reset confirmation and maps unknown errors safely", async () => {
    const { resetGlobalChatSettingsAction } = await import("./actions");
    const unconfirmed = new FormData();
    unconfirmed.set("expectedRevision", "3");
    await expect(
      resetGlobalChatSettingsAction({ status: "idle" }, unconfirmed),
    ).resolves.toEqual({
      status: "error",
      message: "Confirm that deployment defaults should be restored.",
    });
    expect(resetGlobalChatSettings).not.toHaveBeenCalled();

    vi.mocked(resetGlobalChatSettings).mockRejectedValue(
      new Error("provider secret must never escape"),
    );
    const confirmed = new FormData();
    confirmed.set("expectedRevision", "3");
    confirmed.set("confirm", "on");
    await expect(
      resetGlobalChatSettingsAction({ status: "idle" }, confirmed),
    ).resolves.toEqual({
      status: "error",
      message: "Unable to update chat settings. Try again.",
    });
  });
});
