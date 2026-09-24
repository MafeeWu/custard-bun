import { expect, test, vi } from "vitest";
import { createEmailQueue } from "./email-queue";
import { AUTH_EMAIL_QUEUE } from "@/server/jobs/queues";

test("enqueues a typed email job", async () => {
  const send = vi.fn().mockResolvedValue("job-1");
  const queue = createEmailQueue({ send } as never);

  await expect(
    queue.enqueue({
      kind: "reset-password",
      to: "person@example.com",
      actionUrl: "https://example.com/reset?token=secret",
    }),
  ).resolves.toBe("job-1");
  expect(send).toHaveBeenCalledWith(
    AUTH_EMAIL_QUEUE,
    expect.objectContaining({ kind: "reset-password" }),
  );
});

test("throws when pg-boss does not accept the job", async () => {
  const queue = createEmailQueue({
    send: vi.fn().mockResolvedValue(null),
  } as never);

  await expect(
    queue.enqueue({
      kind: "verify-email",
      to: "person@example.com",
      actionUrl: "https://example.com/verify",
    }),
  ).rejects.toThrow("Authentication email job was not accepted");
});
