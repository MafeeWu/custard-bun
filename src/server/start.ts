import { createServer } from "node:http";
import next from "next";
import { loadRuntimeConfig } from "./config/runtime-config-core";
import { startupDiagnostic } from "./config/configuration-error";
import { bindSocketIdentity } from "./http/client-ip";
import { safeErrorName } from "./logging/safe-error";

async function main() {
  await loadRuntimeConfig();
  const port = Number(process.env.PORT ?? 3000);
  const app = next({ dev: false, hostname: "0.0.0.0", port });
  await app.prepare();
  const handle = app.getRequestHandler();
  const server = createServer((request, response) => {
    try {
      bindSocketIdentity(request);
    } catch {
      response.writeHead(400).end();
      return;
    }
    void handle(request, response).catch((error: unknown) => {
      console.error("app request failed", { name: safeErrorName(error) });
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    const timeout = setTimeout(() => process.exit(1), 10_000);
    timeout.unref();
    server.close(() => {
      void app.close().finally(() => process.exit(0));
    });
    server.closeIdleConnections();
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", resolve);
  });
  console.info("app listening", { port });
}

void main().catch((error: unknown) => {
  console.error("app startup failed:", startupDiagnostic(error));
  process.exit(1);
});
