// @vitest-environment node
import { createServer } from "node:http";
import { once } from "node:events";
import { expect, test } from "vitest";
import { bindSocketIdentity } from "./client-ip";

test("only actual socket identity crosses the HTTP boundary regardless of spoofed headers", async () => {
  const server = createServer((request, response) => {
    bindSocketIdentity(request);
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        headers: request.headers,
        rawHeaders: request.rawHeaders,
      }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address() as { port: number };
    const response = await fetch(`http://127.0.0.1:${address.port}`, {
      headers: {
        "x-forwarded-for": "198.51.100.123",
        "x-real-ip": "198.51.100.123",
        forwarded: "for=198.51.100.123",
        "x-companion-client-ip": "198.51.100.123",
      },
    });
    const body = await response.json();
    expect(body.headers["x-companion-client-ip"]).toBe("127.0.0.1");
    expect(JSON.stringify(body)).not.toContain("198.51.100.123");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
