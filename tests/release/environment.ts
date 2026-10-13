import { privacySentinels } from "./privacy-scan";

export function buildReleaseEnvironment(
  image: string,
  ambient: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...ambient,
    POSTGRES_PASSWORD: "release-test-password",
    MODEL_API_KEY: privacySentinels.providerKey,
    MODEL_API_BASE_URL: `http://fake-model:3102/${privacySentinels.providerEndpoint}/v1`,
    MODEL_ID: "e2e-chat-model",
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: "1025",
    SMTP_SECURE: "false",
    SMTP_USER: "test",
    SMTP_PASSWORD: "test",
    SMTP_FROM: "Release Gate <noreply@example.com>",
    APP_PORT: "3300",
    RELEASE_IMAGE: image,
  };
}

export function buildProductionJobEnvironment(
  databaseUrl: string,
  releaseEnvironment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return {
    ...releaseEnvironment,
    DATABASE_URL: databaseUrl,
    TEST_DATABASE_URL: databaseUrl,
    BETTER_AUTH_SECRET: "release-test-secret-at-least-32-characters",
    BETTER_AUTH_URL: "http://localhost:3300",
  };
}
