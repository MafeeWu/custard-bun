// @vitest-environment node
import { beforeAll, beforeEach, afterAll, describe, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import type { RuntimeConfig } from "@/server/config/schema";
import { createDatabase } from "@/server/db/client";
import { createAuth } from "./create-auth";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://companion:companion@127.0.0.1:55432/companion_test";

const database = createDatabase(databaseUrl);

const baseConfig: RuntimeConfig = {
  public: {
    branding: {
      name: "Custard Bun",
      description: "Private conversations with consistent AI characters.",
      logoPath: "/brand/logo.svg",
      faviconPath: "/brand/favicon.svg",
      primaryColor: "#F59E0B",
    },
    registration: {
      open: true,
      maxAttemptsPerHourPerIp: 5,
    },
    links: {
      privacyUrl: "https://example.com/privacy",
      termsUrl: "https://example.com/terms",
      supportUrl: "mailto:support@example.com",
    },
  },
  secret: {
    nodeEnv: "test",
    databaseUrl,
    betterAuthSecret: "test-secret-that-is-at-least-32-characters",
    betterAuthUrl: "http://localhost:3000",
    smtp: {
      host: "127.0.0.1",
      port: 1025,
      secure: false,
      user: "test",
      password: "test",
      from: "Custard Bun <noreply@example.com>",
    },
  },
};

const signUpBody = {
  name: "Person",
  email: "person@example.com",
  password: "correct horse battery staple",
};

function post(path: string, body: object, ip = "192.0.2.10") {
  return new Request(`http://localhost/api/auth${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify(body),
  });
}

async function truncateAuthTables() {
  await database.execute(sql`
    TRUNCATE TABLE "session", "account", "verification", "rate_limit", "user"
    RESTART IDENTITY CASCADE
  `);
}

async function createTestAuth(options: { registrationOpen: boolean }) {
  const config = structuredClone(baseConfig);
  config.public.registration.open = options.registrationOpen;

  const jobs: Array<{
    kind: "verify-email" | "reset-password" | "delete-account";
    to: string;
    actionUrl: string;
  }> = [];

  const auth = createAuth({
    database,
    config,
    emailQueue: {
      async enqueue(job) {
        jobs.push(job);
        return `test-job-${jobs.length}`;
      },
    },
  });

  return { auth, jobs };
}

describe("createAuth", () => {
  beforeAll(async () => {
    await truncateAuthTables();
  });

  beforeEach(async () => {
    await truncateAuthTables();
  });

  afterAll(async () => {
    await database.$client.end();
  });

  test("closed registration rejects the direct endpoint with 403", async () => {
    const { auth } = await createTestAuth({ registrationOpen: false });

    const response = await auth.handler(post("/sign-up/email", signUpBody));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      message: "Registration is currently closed",
    });
  });

  test("unverified users cannot sign in", async () => {
    const { auth } = await createTestAuth({ registrationOpen: true });

    await auth.handler(post("/sign-up/email", signUpBody));
    const response = await auth.handler(
      post("/sign-in/email", {
        email: signUpBody.email,
        password: signUpBody.password,
        rememberMe: true,
      }),
    );

    expect(response.status).toBe(403);
  });

  test("duplicate sign-up has the same public response shape", async () => {
    const { auth } = await createTestAuth({ registrationOpen: true });

    const first = await auth.handler(post("/sign-up/email", signUpBody));
    const duplicate = await auth.handler(post("/sign-up/email", signUpBody));
    const firstBody = (await first.json()) as Record<string, unknown>;
    const duplicateBody = (await duplicate.json()) as Record<string, unknown>;

    expect(duplicate.status).toBe(first.status);
    expect(Object.keys(duplicateBody).sort()).toEqual(
      Object.keys(firstBody).sort(),
    );
  });

  test("password reset does not reveal whether an email exists", async () => {
    const { auth } = await createTestAuth({ registrationOpen: true });

    await auth.handler(post("/sign-up/email", signUpBody));
    const known = await auth.handler(
      post("/request-password-reset", {
        email: signUpBody.email,
        redirectTo: "http://localhost/auth/reset-password",
      }),
    );
    const unknown = await auth.handler(
      post("/request-password-reset", {
        email: "unknown@example.com",
        redirectTo: "http://localhost/auth/reset-password",
      }),
    );
    const knownBody = (await known.json()) as Record<string, unknown>;
    const unknownBody = (await unknown.json()) as Record<string, unknown>;

    expect(unknown.status).toBe(known.status);
    expect(Object.keys(unknownBody).sort()).toEqual(
      Object.keys(knownBody).sort(),
    );
  });
});
