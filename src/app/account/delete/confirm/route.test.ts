// @vitest-environment node
import { expect, test, vi } from "vitest";
const confirm = vi.hoisted(() => vi.fn());
vi.mock("@/server/db/database", () => ({ getDatabase: async () => ({}) }));
vi.mock("@/server/privacy/account-deletion-service", () => ({
  confirmAccountDeletion: confirm,
}));
import { GET, POST } from "./route";
test("GET does not consume email link tokens and serves a confirmation form with safe headers", async () => {
  const response = await GET();
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.text()).toContain("Confirm account deletion");
  expect(confirm).not.toHaveBeenCalled();
});
test.each(["valid", "missing", "expired", "replay"])(
  "POST %s uses the same signed-out response without claiming purge completion",
  async (state) => {
    confirm.mockReset();
    if (state === "expired")
      confirm.mockRejectedValue(new Error("private-provider-token"));
    else confirm.mockResolvedValue({ requestId: "safe-id" });
    const body = new URLSearchParams();
    if (state !== "missing") body.set("token", state);
    const response = await POST(
      new Request("http://localhost:3000/account/delete/confirm", {
        method: "POST",
        body,
      }),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/goodbye",
    );
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await response.text()).toBe("");
  },
);
