interface PostgresUrlOptions {
  username: string;
  password: string;
  host: string;
  port: number;
  database: string;
}

export function buildPostgresUrl({
  username,
  password,
  host,
  port,
  database,
}: PostgresUrlOptions): string {
  const hostname =
    host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  const authority = new URL(`postgresql://${hostname}`);
  authority.port = String(port);

  return [
    "postgresql://",
    encodeURIComponent(username),
    ":",
    encodeURIComponent(password),
    "@",
    authority.host,
    "/",
    encodeURIComponent(database),
  ].join("");
}
