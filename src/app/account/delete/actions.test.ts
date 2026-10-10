import { beforeEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  requestAccountDeletion: vi.fn(),
  enqueueAccountDeletionVerification: vi.fn(),
  enqueue: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/server/auth/require-session", () => ({
  requireSession: mocks.requireSession,
}));
vi.mock("@/server/db/database", () => ({ getDatabase: async () => ({}) }));
vi.mock("@/server/config/load-config", () => ({
  getRuntimeConfig: async () => ({
    secret: { betterAuthUrl: "http://localhost:3000", databaseUrl: "database" },
  }),
}));
vi.mock("@/server/jobs/boss", () => ({ getBoss: async () => ({}) }));
vi.mock("@/server/jobs/queues", () => ({
  ensureQueues: async () => undefined,
}));
vi.mock("@/server/email/email-queue", () => ({
  createEmailQueue: () => ({ enqueue: mocks.enqueue }),
}));
vi.mock("@/server/privacy/account-deletion-service", () => ({
  requestAccountDeletion: mocks.requestAccountDeletion,
  enqueueAccountDeletionVerification: mocks.enqueueAccountDeletionVerification,
}));
import { requestAccountDeletionAction } from "./actions";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSession.mockResolvedValue({
    user: { id: "owner", email: "owner@example.com" },
  });
  mocks.requestAccountDeletion.mockResolvedValue({
    requestId: "safe-request-id",
    verificationToken: "private-token",
  });
  mocks.enqueue.mockResolvedValue("job");
  mocks.enqueueAccountDeletionVerification.mockResolvedValue(undefined);
});
test("deletion request trusts only session ownership, queues application URL and exposes no token", async () => {
  const data = new FormData();
  data.set("userId", "attacker");
  data.set("email", "attacker@example.com");
  const state = await requestAccountDeletionAction({ status: "idle" }, data);
  expect(mocks.requestAccountDeletion).toHaveBeenCalledWith(
    {},
    { userId: "owner", email: "owner@example.com", now: expect.any(Date) },
  );
  expect(mocks.enqueueAccountDeletionVerification).toHaveBeenCalledWith(
    {},
    { enqueue: mocks.enqueue },
    {
      userId: "owner",
      requestId: "safe-request-id",
      verificationToken: "private-token",
      actionUrl:
        "http://localhost:3000/account/delete/confirm#token=private-token",
      now: expect.any(Date),
    },
  );
  expect(state.status).toBe("success");
  expect(JSON.stringify(state)).not.toMatch(/token|owner|request-id/);
});
test("queue failures do not claim dispatch or disclose content", async () => {
  mocks.enqueueAccountDeletionVerification.mockRejectedValue(
    new Error("private-token@example.com"),
  );
  const state = await requestAccountDeletionAction(
    { status: "idle" },
    new FormData(),
  );
  expect(state).toEqual({
    status: "error",
    message: "Unable to request account deletion. Try again.",
  });
});

test("deletion throttling returns only a safe code and guidance without sending mail", async () => {
  mocks.requestAccountDeletion.mockRejectedValue(
    new Error("DELETION_RATE_LIMITED"),
  );
  expect(
    await requestAccountDeletionAction({ status: "idle" }, new FormData()),
  ).toEqual({
    status: "error",
    code: "rate_limited",
    message: "Too many attempts. Please try again later.",
  });
  expect(mocks.enqueue).not.toHaveBeenCalled();
});
