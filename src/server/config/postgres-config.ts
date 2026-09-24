import { parseIntoClientConfig } from "pg-connection-string";
import type { PoolConfig } from "pg";

function decodeHostname(hostname: string): string {
  const decoded = decodeURIComponent(hostname);
  if (decoded.startsWith("[") && decoded.endsWith("]")) {
    return decoded.slice(1, -1);
  }
  return decoded;
}

export function parsePostgresConfig(
  connectionString: string,
): PoolConfig {
  const url = new URL(connectionString);
  const config: PoolConfig = {
    ...parseIntoClientConfig(connectionString),
  };

  if (!url.searchParams.has("user") && url.username) {
    config.user = decodeURIComponent(url.username);
  }
  if (!url.searchParams.has("password") && url.password) {
    config.password = decodeURIComponent(url.password);
  }
  if (!url.searchParams.has("host") && url.hostname) {
    config.host = decodeHostname(url.hostname);
  }
  if (!url.searchParams.has("port") && url.port) {
    config.port = Number(url.port);
  }

  const pathname = url.pathname.slice(1);
  if (pathname) {
    config.database = decodeURIComponent(pathname);
  }

  delete config.connectionString;
  return config;
}
