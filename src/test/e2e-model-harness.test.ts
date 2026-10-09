// @vitest-environment node
import type { AddressInfo } from "node:net";
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, expect, test } from "vitest";
import { createFakeModelServer } from "../../tests/e2e/support/fake-model-server";

let server: ReturnType<typeof createFakeModelServer>;
let baseUrl: string;

beforeEach(async () => {
  server = createFakeModelServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as AddressInfo;
  expect(address.address).toBe("127.0.0.1");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

async function completion(content: string) {
  return fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      authorization: "Bearer e2e-model-key",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "e2e-chat-model",
      messages: [{ role: "user", content }],
      stream: true,
      stream_options: { include_usage: true },
    }),
  });
}

test("streams deterministic chunks, records requests, and resets controls", async () => {
  expect((await fetch(baseUrl)).status).toBe(200);

  const response = await completion("Please [stream]");
  expect(response.status).toBe(200);
  const body = await response.text();
  expect(body).toContain('"content":"Hello"');
  expect(body).toContain('"content":" there"');
  expect(body).toContain('"prompt_tokens":20');
  expect(body).toContain('"completion_tokens":2');
  expect(body).toContain("data: [DONE]");

  const requests = (await (
    await fetch(`${baseUrl}/__e2e__/requests`)
  ).json()) as Array<{ body: { messages: Array<{ content: string }> } }>;
  expect(requests).toHaveLength(1);
  expect(requests[0]?.body.messages.at(-1)?.content).toBe("Please [stream]");

  expect(
    (
      await fetch(`${baseUrl}/__e2e__/control`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ missingUsage: true }),
      })
    ).status,
  ).toBe(204);
  expect(await (await completion("No usage [stream]")).text()).not.toContain(
    '"prompt_tokens"',
  );

  expect(
    (
      await fetch(`${baseUrl}/__e2e__/reset`, {
        method: "POST",
      })
    ).status,
  ).toBe(204);
  expect(
    await (await fetch(`${baseUrl}/__e2e__/requests`)).json(),
  ).toEqual([]);
});

test("supports explicit provider and interruption scenarios", async () => {
  const rateLimit = await completion("[rate-limit]");
  expect(rateLimit.status).toBe(429);
  expect(rateLimit.headers.get("retry-after")).toBe("1");

  expect((await completion("[auth-fail]")).status).toBe(401);

  const interrupted = await completion("[interrupt]");
  expect(await interrupted.text()).toContain("Partial reply");
  const retry = await completion("[interrupt]");
  expect(await retry.text()).toContain("Recovered reply");
  const slow = await completion("[slow]");
  expect(slow.status).toBe(200);
  await slow.body?.cancel();
});

test("uses short application timeouts while the slow provider remains realistically slow", async () => {
  const config = await readFile("tests/e2e/app.config.yml", "utf8");

  expect(config).toContain("firstTokenTimeoutMs: 1000");
  expect(config).toContain("requestTimeoutMs: 5000");
});
