// @vitest-environment node
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import type { PgBoss } from "pg-boss";
import { eq, sql } from "drizzle-orm";
import type { RuntimeConfig } from "@/server/config/schema";
import { createDatabase } from "@/server/db/client";
import { account, user } from "@/server/db/auth-schema";
import { createEmailQueue, type EmailQueue } from "@/server/email/email-queue";
import { createBoss } from "@/server/jobs/boss";
import { AUTH_EMAIL_QUEUE, ensureQueues } from "@/server/jobs/queues";
import { createAuth } from "./create-auth";
import { testDatabaseUrl } from "@/test/database-target";
import { inspect } from "node:util";

const databaseUrl = testDatabaseUrl();

const database = createDatabase(databaseUrl);
const boss = createBoss(databaseUrl);
const baseUrl = "http://localhost:3000";

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
    betterAuthUrl: baseUrl,
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
const leakedToken = "private-session-token-SQL-credential";

function post(path: string, body: object, ip = "192.0.2.10") {
  return new Request(`${baseUrl}/api/auth${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
      "x-companion-client-ip": ip,
    },
    body: JSON.stringify(body),
  });
}

async function truncateTestState() {
  await database.execute(sql`
    TRUNCATE TABLE
      "session",
      "account",
      "verification",
      "rate_limit",
      "user",
      job.job,
      job.job_dependency
    RESTART IDENTITY CASCADE
  `);
}

async function countPersistedAuthRecords() {
  const [persistedUsers, persistedAccounts] = await Promise.all([
    database.select().from(user),
    database.select().from(account),
  ]);

  return {
    userCount: persistedUsers.length,
    credentialAccountCount: persistedAccounts.length,
  };
}

function normalizeSignUpResponse(body: Record<string, unknown>) {
  const publicUser = body.user;
  if (!publicUser || typeof publicUser !== "object") {
    return body;
  }

  return {
    ...body,
    user: {
      ...publicUser,
      id: "<generated-id>",
      createdAt: "<generated-timestamp>",
      updatedAt: "<generated-timestamp>",
    },
  };
}

async function createTestAuth(options: {
  registrationOpen: boolean;
  emailQueue?: EmailQueue;
}) {
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
    emailQueue:
      options.emailQueue ??
      ({
        async enqueue(job) {
          if (job.kind !== "noop") jobs.push(job);
          return `test-job-${jobs.length}`;
        },
      } satisfies EmailQueue),
  });

  return { auth, jobs };
}

describe("createAuth", () => {
  beforeAll(async () => {
    await boss.start();
    await ensureQueues(boss, { authEmailRetryDelay: 60 });
    await truncateTestState();
  });

  beforeEach(async () => {
    await truncateTestState();
  });

  afterAll(async () => {
    await boss.offWork(AUTH_EMAIL_QUEUE);
    await boss.deleteAllJobs(AUTH_EMAIL_QUEUE);
    await boss.stop({ graceful: false });
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

  test("rate limits use boundary identity, never caller forwarding identity", async () => {
    const { auth } = await createTestAuth({ registrationOpen: true });
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt++) {
      const request = post(
        "/sign-up/email",
        signUpBody,
        `192.0.2.${attempt + 1}`,
      );
      request.headers.set("x-companion-client-ip", "203.0.113.10");
      statuses.push((await auth.handler(request)).status);
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  });

  test("duplicate sign-up has the same public response after normalizing generated fields", async () => {
    const { auth } = await createTestAuth({ registrationOpen: true });

    const first = await auth.handler(post("/sign-up/email", signUpBody));
    const duplicate = await auth.handler(post("/sign-up/email", signUpBody));
    const firstBody = (await first.json()) as Record<string, unknown>;
    const duplicateBody = (await duplicate.json()) as Record<string, unknown>;

    expect(duplicate.status).toBe(first.status);
    expect(normalizeSignUpResponse(duplicateBody)).toEqual(
      normalizeSignUpResponse(firstBody),
    );
  });

  test("password reset does not reveal whether an email exists", async () => {
    const { auth } = await createTestAuth({ registrationOpen: true });

    await auth.handler(post("/sign-up/email", signUpBody));
    const known = await auth.handler(
      post("/request-password-reset", {
        email: signUpBody.email,
        redirectTo: `${baseUrl}/auth/reset-password`,
      }),
    );
    const unknown = await auth.handler(
      post("/request-password-reset", {
        email: "unknown@example.com",
        redirectTo: `${baseUrl}/auth/reset-password`,
      }),
    );
    const knownBody = (await known.json()) as Record<string, unknown>;
    const unknownBody = (await unknown.json()) as Record<string, unknown>;

    expect(unknown.status).toBe(known.status);
    expect(unknownBody).toEqual(knownBody);
  });

  test("failed verification email enqueue rolls signup back completely", async () => {
    const { auth } = await createTestAuth({
      registrationOpen: true,
      emailQueue: {
        async enqueue() {
          throw new Error("queue rejected");
        },
      },
    });

    const response = await auth.handler(post("/sign-up/email", signUpBody));
    expect(response.status).toBe(500);
    await expect(countPersistedAuthRecords()).resolves.toEqual({
      userCount: 0,
      credentialAccountCount: 0,
    });
  });

  test("queue failure is indistinguishable for new and duplicate signup", async () => {
    const existing = await createTestAuth({ registrationOpen: true });
    await existing.auth.handler(post("/sign-up/email", signUpBody));
    const { auth } = await createTestAuth({
      registrationOpen: true,
      emailQueue: {
        async enqueue() {
          throw new Error(leakedToken);
        },
      },
    });
    const duplicate = await auth.handler(post("/sign-up/email", signUpBody));
    const fresh = await auth.handler(
      post("/sign-up/email", {
        ...signUpBody,
        email: "fresh@example.com",
      }),
    );
    expect(duplicate.status).toBe(500);
    expect(fresh.status).toBe(500);
    expect(await duplicate.text()).toBe(await fresh.text());
    await expect(countPersistedAuthRecords()).resolves.toEqual({
      userCount: 1,
      credentialAccountCount: 1,
    });
  });

  test("reset acceptance failures are identical for known and unknown accounts", async () => {
    const existing = await createTestAuth({ registrationOpen: true });
    await existing.auth.handler(post("/sign-up/email", signUpBody));
    const { auth } = await createTestAuth({
      registrationOpen: true,
      emailQueue: {
        async enqueue() {
          throw new Error(leakedToken);
        },
      },
    });
    const responses = await Promise.all(
      [signUpBody.email, "unknown@example.com"].map((email) =>
        auth.handler(post("/request-password-reset", { email })),
      ),
    );
    expect(responses.map((response) => response.status)).toEqual([500, 500]);
    const bodies = await Promise.all(
      responses.map((response) => response.text()),
    );
    expect(bodies[0]).toBe(bodies[1]);
    expect(bodies.join()).not.toContain(leakedToken);
  });

  async function signInVerified(auth: ReturnType<typeof createAuth>) {
    await auth.handler(post("/sign-up/email", signUpBody));
    await database
      .update(user)
      .set({ emailVerified: true })
      .where(eq(user.email, signUpBody.email));
    const signedIn = await auth.handler(post("/sign-in/email", signUpBody));
    expect(signedIn.status).toBe(200);
    return signedIn.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0])
      .join("; ");
  }

  test("authenticated deletion does not claim dispatch when enqueue fails", async () => {
    const existing = await createTestAuth({ registrationOpen: true });
    const cookie = await signInVerified(existing.auth);
    const { auth } = await createTestAuth({
      registrationOpen: true,
      emailQueue: {
        async enqueue() {
          throw new Error(leakedToken);
        },
      },
    });
    const request = post("/delete-user", { callbackURL: "/goodbye" });
    request.headers.set("cookie", cookie);
    const response = await auth.handler(request);
    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).not.toMatch(/sent|private-session/);
    expect((await countPersistedAuthRecords()).userCount).toBe(1);
  });

  test("password recovery invalidates a retained authenticated session", async () => {
    const { auth, jobs } = await createTestAuth({ registrationOpen: true });
    const cookie = await signInVerified(auth);
    const session = () =>
      auth.api.getSession({ headers: new Headers({ cookie }) });
    expect(await session()).not.toBeNull();
    await auth.handler(
      post("/request-password-reset", { email: signUpBody.email }),
    );
    const job = jobs.find((job) => job.kind === "reset-password");
    const token = new URL(job!.actionUrl).pathname.split("/").pop();
    const response = await auth.handler(
      post("/reset-password", {
        token,
        newPassword: "new correct horse battery staple",
      }),
    );
    expect(response.status).toBe(200);
    expect(await session()).toBeNull();
  });

  test("direct and background Better Auth errors never log token-bearing exceptions", async () => {
    const output = [
      vi.spyOn(console, "error").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
      vi.spyOn(console, "log").mockImplementation(() => {}),
    ];
    const { auth } = await createTestAuth({
      registrationOpen: true,
      emailQueue: {
        async enqueue() {
          throw new Error(leakedToken);
        },
      },
    });
    await auth.handler(post("/sign-up/email", signUpBody));
    const context = await auth.$context;
    await context.runInBackgroundOrAwait(
      Promise.reject(new TypeError(leakedToken)),
    );
    const logs = inspect(
      output.flatMap((spy) => spy.mock.calls),
      { depth: 6 },
    );
    expect(logs).not.toContain(leakedToken);
    expect(logs).toContain("TypeError");
    expect(logs).toContain("auth");
  });

  test("SMTP worker failures keep the created account and retryable job", async () => {
    const queuedJobIds: string[] = [];
    const durableEmailQueue = createEmailQueue(boss as Pick<PgBoss, "send">);
    const { auth } = await createTestAuth({
      registrationOpen: true,
      emailQueue: {
        async enqueue(job) {
          const jobId = await durableEmailQueue.enqueue(job);
          queuedJobIds.push(jobId);
          return jobId;
        },
      },
    });

    const response = await auth.handler(post("/sign-up/email", signUpBody));

    expect(response.status).toBe(200);
    expect(queuedJobIds).toHaveLength(1);
    await expect(countPersistedAuthRecords()).resolves.toEqual({
      userCount: 1,
      credentialAccountCount: 1,
    });

    let attempts = 0;

    try {
      await boss.work(AUTH_EMAIL_QUEUE, async () => {
        attempts += 1;
        throw new Error("temporary SMTP failure");
      });

      await expect.poll(() => attempts, { timeout: 5_000 }).toBe(1);
      await expect
        .poll(
          async () =>
            (await boss.getJobById(AUTH_EMAIL_QUEUE, queuedJobIds[0]))?.state,
          {
            timeout: 5_000,
          },
        )
        .toBe("retry");

      const job = await boss.getJobById(AUTH_EMAIL_QUEUE, queuedJobIds[0]);
      expect(job?.output).toEqual(
        expect.objectContaining({ message: "temporary SMTP failure" }),
      );
      await expect(countPersistedAuthRecords()).resolves.toEqual({
        userCount: 1,
        credentialAccountCount: 1,
      });
    } finally {
      await boss.offWork(AUTH_EMAIL_QUEUE);
    }
  });
});
