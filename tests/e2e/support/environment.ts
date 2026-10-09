import { testDatabaseUrl } from "../../../src/test/database-target";

function definedEnvironmentEntries(
  env: NodeJS.ProcessEnv,
): Array<[string, string]> {
  return Object.entries(env).flatMap(([key, value]) =>
    value === undefined ? [] : [[key, value]],
  );
}

export type E2eEnvironment = Record<string, string> & NodeJS.ProcessEnv;

export function createE2eEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): E2eEnvironment {
  const databaseUrl = testDatabaseUrl({
    TEST_DATABASE_URL: env.TEST_DATABASE_URL,
  });

  return Object.fromEntries([
    ...definedEnvironmentEntries(env),
    ["APP_CONFIG_PATH", "tests/e2e/app.config.yml"],
    ["NODE_ENV", "test"],
    ["DATABASE_URL", databaseUrl],
    ["TEST_DATABASE_URL", databaseUrl],
    ["BETTER_AUTH_SECRET", "test-secret-that-is-at-least-32-characters"],
    ["BETTER_AUTH_URL", "http://127.0.0.1:3000"],
    ["SMTP_HOST", "127.0.0.1"],
    ["SMTP_PORT", "1025"],
    ["SMTP_SECURE", "false"],
    ["SMTP_USER", "test"],
    ["SMTP_PASSWORD", "test"],
    ["SMTP_FROM", "Custard Bun <noreply@example.com>"],
    ["MODEL_API_BASE_URL", "http://127.0.0.1:3102/v1"],
    ["MODEL_API_KEY", "e2e-model-key"],
    ["MODEL_ID", "e2e-chat-model"],
  ]) as E2eEnvironment;
}

export const e2eEnvironment = createE2eEnvironment();
