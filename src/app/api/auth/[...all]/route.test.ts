// @vitest-environment node
import { expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuth: vi.fn().mockResolvedValue({ api: "auth" }),
  get: vi.fn().mockResolvedValue(new Response("get")),
  post: vi.fn().mockResolvedValue(new Response("post")),
  toNextJsHandler: vi.fn(),
}));

mocks.toNextJsHandler.mockReturnValue({
  GET: mocks.get,
  POST: mocks.post,
});

vi.mock("@/server/auth/auth", () => ({
  getAuth: mocks.getAuth,
}));

vi.mock("better-auth/next-js", () => ({
  toNextJsHandler: mocks.toNextJsHandler,
}));

import { GET, POST } from "./route";

test("does not initialize auth while the route module loads", () => {
  expect(mocks.getAuth).not.toHaveBeenCalled();
  expect(mocks.toNextJsHandler).not.toHaveBeenCalled();
});

test.each([
  ["GET", GET, mocks.get],
  ["POST", POST, mocks.post],
] as const)("initializes auth lazily for %s requests", async (_method, route, handler) => {
  const request = new Request("http://127.0.0.1:3000/api/auth/session");

  await route(request);

  expect(mocks.getAuth).toHaveBeenCalled();
  expect(mocks.toNextJsHandler).toHaveBeenCalledWith({ api: "auth" });
  expect(handler).toHaveBeenCalledWith(request);
});
