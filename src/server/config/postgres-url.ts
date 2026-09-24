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
  const url = new URL("postgresql://localhost");
  url.username = username;
  url.password = password;
  url.hostname = host;
  url.port = String(port);
  url.pathname = `/${database}`;
  return url.toString();
}
