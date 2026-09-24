import { buildPostgresUrl } from "./postgres-url";

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`environment.${name}: Required`);
  }
  return value;
}

const port = Number(process.env.POSTGRES_PORT ?? "5432");
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("environment.POSTGRES_PORT: Invalid port");
}

process.stdout.write(
  buildPostgresUrl({
    username: requireEnvironment("POSTGRES_USER"),
    password: requireEnvironment("POSTGRES_PASSWORD"),
    host: requireEnvironment("POSTGRES_HOST"),
    port,
    database: requireEnvironment("POSTGRES_DB"),
  }),
);
