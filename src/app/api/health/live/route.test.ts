// @vitest-environment node
import { expect, test } from "vitest";
import { GET } from "./route";

test("returns liveness without dependency details", async () => {
  const response = await GET();

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: "ok" });
});
