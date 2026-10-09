// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";
import { ChatDomainError } from "@/server/chat/chat-errors";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getGenerationService: vi.fn(),
  stop: vi.fn(),
}));

vi.mock("@/server/auth/require-session", () => ({
  requireSession: mocks.requireSession,
}));
vi.mock("@/server/chat/generation-service", () => ({
  getGenerationService: mocks.getGenerationService,
}));

import { POST } from "./route";

const attemptId = "30000000-0000-4000-8000-000000000003";

beforeEach(() => {
  mocks.requireSession.mockResolvedValue({ user: { id: "user-1" } });
  mocks.getGenerationService.mockResolvedValue({ stop: mocks.stop });
});

function request() {
  return new Request(`http://localhost/api/chat/attempts/${attemptId}/stop`, {
    method: "POST",
  });
}

function context(id = attemptId) {
  return { params: Promise.resolve({ id }) };
}

test("returns 202 only after stopping an owned active attempt", async () => {
  const response = await POST(request(), context());

  expect(response.status).toBe(202);
  expect(await response.text()).toBe("");
  expect(mocks.stop).toHaveBeenCalledWith({
    userId: "user-1",
    attemptId,
  });
});

test("returns typed 404 for another user's or terminal attempt", async () => {
  mocks.stop.mockRejectedValue(
    new ChatDomainError("CHAT_NOT_FOUND", "private"),
  );

  const response = await POST(request(), context());

  expect(response.status).toBe(404);
  expect(JSON.parse(await response.text())).toEqual({
    error: {
      code: "CHAT_NOT_FOUND",
      message: "The requested chat was not found.",
      retryable: false,
    },
  });
});

test("rejects an invalid attempt id before service contact", async () => {
  const response = await POST(request(), context("not-a-uuid"));

  expect(response.status).toBe(400);
  expect(mocks.stop).not.toHaveBeenCalled();
});

test("preserves authoritative unauthenticated behavior", async () => {
  const redirect = new Error("NEXT_REDIRECT");
  mocks.requireSession.mockRejectedValue(redirect);

  await expect(POST(request(), context())).rejects.toBe(redirect);
  expect(mocks.stop).not.toHaveBeenCalled();
});
