// @vitest-environment node
import type { AddressInfo } from "node:net";
import { expect, test } from "vitest";
import { createExportBarrier } from "../../tests/e2e/support/export-barrier";

test("a loopback barrier pauses only an armed owner's actual claim and resumes exactly that execution", async () => {
  const barrier = createExportBarrier();
  await new Promise<void>((resolve) =>
    barrier.server.listen(0, "127.0.0.1", resolve),
  );
  const base = `http://127.0.0.1:${(barrier.server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown) =>
    fetch(`${base}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const claim = { exportId: "export", userId: "owner", attemptCount: 1 };
  let resumed = false;
  try {
    expect((await post("arm", { userId: "owner" })).status).toBe(204);
    await barrier.afterClaim({ ...claim, userId: "other" });
    const execution = barrier.afterClaim(claim).then(() => {
      resumed = true;
    });
    expect(await (await fetch(`${base}/state`)).json()).toEqual({
      state: "paused",
      ...claim,
    });
    expect(resumed).toBe(false);
    expect((await post("resume", { exportId: "wrong" })).status).toBe(409);
    expect((await post("arm", { userId: "other" })).status).toBe(409);
    expect(resumed).toBe(false);
    expect((await post("resume", { exportId: "export" })).status).toBe(204);
    await execution;
    expect(resumed).toBe(true);
    expect(await (await fetch(`${base}/state`)).json()).toEqual({
      state: "resumed",
      ...claim,
    });
    expect((await post("resume", { exportId: "export" })).status).toBe(409);
  } finally {
    barrier.release();
    await new Promise<void>((resolve, reject) =>
      barrier.server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
