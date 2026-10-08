// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuth: vi.fn(),
  redirect: vi.fn(() => {
    throw new Error("redirect:/auth/sign-in");
  }),
  notFound: vi.fn(() => {
    throw new Error("notFound");
  }),
}));

vi.mock("@/server/auth/auth", () => ({
  getAuth: mocks.getAuth,
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  notFound: mocks.notFound,
}));

beforeEach(() => {
  vi.resetModules();
  mocks.getAuth.mockReset();
  mocks.redirect.mockClear();
  mocks.notFound.mockClear();
});

test("redirects missing sessions to sign-in", async () => {
  mocks.getAuth.mockResolvedValue({
    api: {
      getSession: vi.fn().mockResolvedValue(null),
    },
  });

  const { requireAdmin } = await import("./require-admin");

  await expect(requireAdmin(new Headers())).rejects.toThrow(
    "redirect:/auth/sign-in",
  );
  expect(mocks.redirect).toHaveBeenCalledWith("/auth/sign-in");
  expect(mocks.notFound).not.toHaveBeenCalled();
});

test("returns no access to signed-in non-administrators", async () => {
  mocks.getAuth.mockResolvedValue({
    api: {
      getSession: vi.fn().mockResolvedValue({
        user: { id: "user-1", email: "u@example.com", role: "user" },
      }),
    },
  });

  const { requireAdmin } = await import("./require-admin");

  await expect(requireAdmin(new Headers())).rejects.toThrow("notFound");
  expect(mocks.notFound).toHaveBeenCalledOnce();
  expect(mocks.redirect).not.toHaveBeenCalled();
});

test("returns a bounded admin actor", async () => {
  mocks.getAuth.mockResolvedValue({
    api: {
      getSession: vi.fn().mockResolvedValue({
        user: { id: "admin-1", email: "a@example.com", role: "admin" },
      }),
    },
  });

  const { requireAdmin } = await import("./require-admin");

  await expect(requireAdmin(new Headers())).resolves.toEqual({
    userId: "admin-1",
    label: "a@example.com",
    operationId: expect.any(String),
  });
});
