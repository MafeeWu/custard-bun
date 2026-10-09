import { beforeEach, describe, expect, test, vi } from "vitest";
import { requireAdmin } from "@/server/admin/require-admin";
import {
  disableOrdinaryUser,
  restoreOrdinaryUser,
} from "@/server/admin/user-service";
import { setUserChatQuotaOverride } from "@/server/admin/chat-settings-service";
import { getDatabase } from "@/server/db/database";

const revalidatePath = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers([["cookie", "session=1"]]),
}));
vi.mock("@/server/admin/require-admin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/server/db/database", () => ({ getDatabase: vi.fn() }));
vi.mock("@/server/admin/user-service", () => ({
  disableOrdinaryUser: vi.fn(),
  restoreOrdinaryUser: vi.fn(),
}));
vi.mock("@/server/admin/chat-settings-service", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("@/server/admin/chat-settings-service")
    >();
  return {
    ...original,
    setUserChatQuotaOverride: vi.fn(),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdmin).mockResolvedValue({
    userId: "real-admin",
    label: "real@example.com",
    operationId: "op-1",
  });
  vi.mocked(getDatabase).mockResolvedValue({ db: true } as never);
});

describe("user administration actions", () => {
  test("disables with the required admin actor and ignores forged actor fields", async () => {
    const { disableUserAction } = await import("./actions");
    const formData = new FormData();
    formData.set("actorUserId", "forged-admin");
    formData.set("reason", "Repeated abuse of instance rules");
    formData.set("confirm", "on");

    await expect(
      disableUserAction("user-from-server-row", { status: "idle" }, formData),
    ).resolves.toEqual({ status: "success", message: "User disabled." });

    expect(disableOrdinaryUser).toHaveBeenCalledWith(
      { db: true },
      { userId: "real-admin", label: "real@example.com", operationId: "op-1" },
      {
        userId: "user-from-server-row",
        reason: "Repeated abuse of instance rules",
      },
    );
    expect(
      JSON.stringify(vi.mocked(disableOrdinaryUser).mock.calls[0]),
    ).not.toContain("forged-admin");
    expect(revalidatePath).toHaveBeenCalledWith("/admin/users");
  });

  test("requires explicit confirmation before disabling", async () => {
    const { disableUserAction } = await import("./actions");
    const formData = new FormData();
    formData.set("reason", "Repeated abuse of instance rules");

    await expect(
      disableUserAction("user-1", { status: "idle" }, formData),
    ).resolves.toEqual({
      status: "error",
      message: "Confirm that this user should be disabled.",
    });
    expect(requireAdmin).toHaveBeenCalled();
    expect(disableOrdinaryUser).not.toHaveBeenCalled();
  });

  test("maps service errors without reporting success", async () => {
    vi.mocked(disableOrdinaryUser).mockRejectedValue(
      new Error("Only ordinary users can be managed"),
    );
    const { disableUserAction } = await import("./actions");
    const formData = new FormData();
    formData.set("reason", "Repeated abuse of instance rules");
    formData.set("confirm", "on");

    await expect(
      disableUserAction("admin-2", { status: "idle" }, formData),
    ).resolves.toEqual({
      status: "error",
      message: "Only ordinary users can be managed",
    });
  });

  test("restores with the required admin actor", async () => {
    const { restoreUserAction } = await import("./actions");

    await expect(
      restoreUserAction(
        "user-from-server-row",
        { status: "idle" },
        new FormData(),
      ),
    ).resolves.toEqual({ status: "success", message: "User restored." });

    expect(restoreOrdinaryUser).toHaveBeenCalledWith(
      { db: true },
      { userId: "real-admin", label: "real@example.com", operationId: "op-1" },
      { userId: "user-from-server-row" },
    );
    expect(revalidatePath).toHaveBeenCalledWith("/admin/users");
  });

  test("sets nullable user quota overrides and revalidates both admin pages", async () => {
    const { setUserQuotaAction } = await import("./actions");
    const formData = new FormData();
    formData.set("dailyRequestLimit", "25");
    formData.set("dailyTokenLimit", "");

    await expect(
      setUserQuotaAction("user-from-server-row", { status: "idle" }, formData),
    ).resolves.toEqual({
      status: "success",
      message: "User quota override updated.",
      values: { dailyRequestLimit: "25", dailyTokenLimit: "" },
    });
    expect(setUserChatQuotaOverride).toHaveBeenCalledWith(
      { db: true },
      { userId: "real-admin", label: "real@example.com", operationId: "op-1" },
      {
        userId: "user-from-server-row",
        dailyRequestLimit: 25,
        dailyTokenLimit: null,
      },
    );
    expect(revalidatePath).toHaveBeenCalledWith("/admin/users");
    expect(revalidatePath).toHaveBeenCalledWith("/admin/usage");
  });

  test("preserves invalid override values without calling the service", async () => {
    const { setUserQuotaAction } = await import("./actions");
    const formData = new FormData();
    formData.set("dailyRequestLimit", "0");
    formData.set("dailyTokenLimit", "private provider secret");

    await expect(
      setUserQuotaAction("user-1", { status: "idle" }, formData),
    ).resolves.toMatchObject({
      status: "error",
      values: {
        dailyRequestLimit: "0",
        dailyTokenLimit: "private provider secret",
      },
    });
    expect(setUserChatQuotaOverride).not.toHaveBeenCalled();
  });

  test("does not expose unexpected quota service errors", async () => {
    vi.mocked(setUserChatQuotaOverride).mockRejectedValue(
      new Error("provider secret must never escape"),
    );
    const { setUserQuotaAction } = await import("./actions");
    const formData = new FormData();
    formData.set("dailyRequestLimit", "25");
    formData.set("dailyTokenLimit", "5000");

    await expect(
      setUserQuotaAction("user-1", { status: "idle" }, formData),
    ).resolves.toMatchObject({
      status: "error",
      message: "Unable to update the user. Try again.",
    });
  });
});
