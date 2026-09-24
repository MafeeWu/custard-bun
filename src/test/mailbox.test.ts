// @vitest-environment node
import { afterEach, expect, test, vi } from "vitest";
import {
  clearMailbox,
  waitForActionUrl,
} from "../../tests/e2e/helpers/mailbox";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("clears Mailpit and rejects an unsuccessful response", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response("unavailable", {
      status: 503,
      statusText: "Service Unavailable",
    }),
  );
  vi.stubGlobal("fetch", fetchMock);

  await expect(clearMailbox()).rejects.toThrow(
    "Unable to clear Mailpit mailbox: 503",
  );
  expect(fetchMock).toHaveBeenCalledWith(
    "http://127.0.0.1:8025/api/v1/messages",
    { method: "DELETE" },
  );
});

test("returns the matching local action URL from a Mailpit message", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        Messages: [
          {
            ID: "message-1",
            Subject: "Verify your Custard Bun email",
            To: [{ Address: "person@example.com" }],
          },
        ],
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        Text: [
          "Verify your email",
          "",
          "http://127.0.0.1:3000/api/auth/verify-email?token=abc",
        ].join("\n"),
      }),
    );
  vi.stubGlobal("fetch", fetchMock);

  await expect(
    waitForActionUrl("person@example.com", "Verify your"),
  ).resolves.toBe(
    "http://127.0.0.1:3000/api/auth/verify-email?token=abc",
  );
});
