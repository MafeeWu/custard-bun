export function testDatabaseUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  const target =
    env.TEST_DATABASE_URL ??
    env.DATABASE_URL ??
    "postgresql://companion:companion@127.0.0.1:55432/companion_test";
  try {
    const url = new URL(target);
    if (
      url.protocol === "postgresql:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
      /^\/[^/]+_test$/.test(decodeURIComponent(url.pathname)) &&
      !url.search &&
      !url.hash
    )
      return target;
  } catch {
    // Report only the safe target requirement, never a supplied connection URL.
  }
  throw new Error(
    "Tests require a loopback PostgreSQL database ending in _test",
  );
}
