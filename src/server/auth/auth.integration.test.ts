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
import type { EmailQueueJob } from "@/server/email/email-job";
import { eq, sql } from "drizzle-orm";
import type { RuntimeConfig } from "@/server/config/schema";
import { createDatabase, type Database } from "@/server/db/client";
import { account, session, user, verification } from "@/server/db/auth-schema";
import { characterVersion } from "@/server/db/character-schema";
import { disableOrdinaryUser } from "@/server/admin/user-service";
import { createCharacterService } from "@/server/characters/character-service";
import { OFFICIAL_CHARACTER_SEEDS } from "@/server/characters/seed-definitions";
import { seedChatSettings } from "@/server/chat/chat-settings-seed";
import { createEmailQueue, type EmailQueue } from "@/server/email/email-queue";
import { createBoss } from "@/server/jobs/boss";
import { AUTH_EMAIL_QUEUE, ensureQueues } from "@/server/jobs/queues";
import { createAuth } from "./create-auth";
import { testDatabaseUrl } from "@/test/database-target";
import { inspect } from "node:util";
import { getAuth } from "./auth";
import { requireSession } from "./require-session";
import {
  requestAccountDeletion,
  confirmAccountDeletion,
} from "@/server/privacy/account-deletion-service";
import { processAccountPurgeStage } from "@/server/privacy/account-purge-job";
import { seedMemorySettings } from "@/server/memory/memory-settings-seed";

vi.mock("./auth", () => ({ getAuth: vi.fn() }));
vi.mock("@/server/config/load-config", () => ({
  getRuntimeConfig: async () => ({
    secret: { betterAuthSecret: "test-secret-that-is-at-least-32-characters" },
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));

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
    chat: {
      firstTokenTimeoutMs: 30000,
      requestTimeoutMs: 120000,
      promptTokenBudget: 8192,
      maxInputCharacters: 12000,
      maxOutputTokens: 1024,
      defaultUserDailyRequestLimit: 100,
      defaultUserDailyTokenLimit: 100000,
      defaultInstanceMonthlyRequestLimit: 10000,
      defaultInstanceMonthlyTokenBudget: 10000000,
      maxConcurrentGenerations: 4,
    },
    memory: {
      enabled: true,
      promptTokenBudget: 2048,
      relationshipSummaryTokenBudget: 512,
      memoryItemsTokenBudget: 1536,
      maxActiveItemsPerCharacter: 200,
      maxItemCharacters: 500,
      maxSummaryCharacters: 4000,
      extractionRetryLimit: 5,
      extractionRetryDelaySeconds: 60,
      exportRetentionHours: 24,
      maxExportArchiveBytes: 262144000,
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
    model: {
      apiBaseUrl: "http://127.0.0.1:3102/v1",
      apiKey: "test-model-key",
      modelId: "test-chat-model",
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

async function ensureChatSettings() {
  await seedChatSettings(database, baseConfig.public.chat);
  await seedMemorySettings(database, baseConfig.public.memory);
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
  database?: Database;
}) {
  const config = structuredClone(baseConfig);
  config.public.registration.open = options.registrationOpen;

  const jobs: Array<{
    kind: "verify-email" | "reset-password" | "delete-account";
    to: string;
    actionUrl: string;
  }> = [];

  const auth = createAuth({
    database: options.database ?? database,
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

async function waitForDatabaseLock(applicationName: string) {
  await expect
    .poll(
      async () => {
        const { rows } = await database.$client.query(
          `SELECT 1 FROM pg_stat_activity
           WHERE application_name = $1 AND wait_event_type = 'Lock'
             AND state = 'active'`,
          [applicationName],
        );
        return rows.length;
      },
      { timeout: 2_000 },
    )
    .toBe(1);
}

describe("createAuth", () => {
  beforeAll(async () => {
    await boss.start();
    await ensureQueues(boss, { authEmailRetryDelay: 60 });
    await truncateTestState();
    await ensureChatSettings();
  });

  beforeEach(async () => {
    await truncateTestState();
    await ensureChatSettings();
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

  async function insertAdministrator() {
    const actor = {
      userId: "disable-race-admin",
      label: "disable-race-admin@example.com",
      operationId: "disable-race",
    };
    await database.insert(user).values({
      id: actor.userId,
      name: "Administrator",
      email: actor.label,
      emailVerified: true,
      role: "admin",
    });
    return actor;
  }

  test("rejects an in-flight Better Auth session insertion ordered after disabling", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const loginDatabase = createDatabase(databaseUrl, {
      application_name: "login-after-disable",
      max: 1,
    });
    const disableDatabase = createDatabase(databaseUrl, {
      application_name: "disable-before-login",
      max: 1,
    });
    const { auth } = await createTestAuth({
      registrationOpen: true,
      database: loginDatabase,
    });
    await auth.handler(post("/sign-up/email", signUpBody));
    const [target] = await database
      .update(user)
      .set({ emailVerified: true })
      .where(eq(user.email, signUpBody.email))
      .returning();
    const actor = await insertAdministrator();
    const locker = await database.$client.connect();
    const operations: Promise<unknown>[] = [];

    try {
      await locker.query("BEGIN");
      await locker.query('SELECT id FROM "user" WHERE id = $1 FOR UPDATE', [
        target.id,
      ]);
      const disabling = disableOrdinaryUser(disableDatabase, actor, {
        userId: target.id,
        reason: "Account disabled during sign-in",
      });
      operations.push(disabling);
      void disabling.catch(() => undefined);
      await waitForDatabaseLock("disable-before-login");

      // Better Auth reads the still-active user before its INSERT waits on the row lock.
      const signingIn = auth.handler(post("/sign-in/email", signUpBody));
      operations.push(signingIn);
      void signingIn.catch(() => undefined);
      await waitForDatabaseLock("login-after-disable");
      const { rows } = await database.$client.query(
        "SELECT query FROM pg_stat_activity WHERE application_name = $1",
        ["login-after-disable"],
      );
      expect(rows[0].query).toMatch(/insert into "session"/i);

      await locker.query("COMMIT");
      await disabling;
      const response = await signingIn;

      expect(
        await database
          .select()
          .from(session)
          .where(eq(session.userId, target.id)),
      ).toHaveLength(0);
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        code: "BANNED_USER",
      });
      expect(response.headers.getSetCookie().join(";")).not.toMatch(
        /session_token=[^;]/,
      );
      expect(inspect(errorLog.mock.calls)).not.toMatch(
        /Failed query|params:|session_token|in-flight-token/,
      );
      expect(
        await database.select().from(user).where(eq(user.id, target.id)),
      ).toMatchObject([{ banned: true }]);
    } finally {
      await locker.query("ROLLBACK");
      locker.release();
      await Promise.allSettled(operations);
      await loginDatabase.$client.end();
      await disableDatabase.$client.end();
    }
  });

  test("deletes a session insertion committed before the disable lock is acquired", async () => {
    const { auth } = await createTestAuth({ registrationOpen: true });
    await auth.handler(post("/sign-up/email", signUpBody));
    const [target] = await database.select().from(user);
    const actor = await insertAdministrator();
    const disablingDatabase = createDatabase(databaseUrl, {
      application_name: "disable-after-session",
      max: 1,
    });
    const inserting = await database.$client.connect();
    let disabling: Promise<void> | undefined;

    try {
      await inserting.query("BEGIN");
      await inserting.query(
        `INSERT INTO session (id, token, user_id, expires_at, updated_at)
         VALUES ($1, $2, $3, NOW() + INTERVAL '1 day', NOW())`,
        ["in-flight-session", "in-flight-token", target.id],
      );
      disabling = disableOrdinaryUser(disablingDatabase, actor, {
        userId: target.id,
        reason: "Account disabled after session insertion",
      });
      void disabling.catch(() => undefined);
      await waitForDatabaseLock("disable-after-session");
      await inserting.query("COMMIT");
      await disabling;

      expect(await database.select().from(session)).toHaveLength(0);
      expect(
        await database.select().from(user).where(eq(user.id, target.id)),
      ).toMatchObject([{ banned: true }]);
    } finally {
      await inserting.query("ROLLBACK");
      inserting.release();
      await Promise.allSettled(disabling ? [disabling] : []);
      await disablingDatabase.$client.end();
    }
  });

  test.each(["banned", "deleting"])(
    "rejects a retained %s session at the protected-page boundary",
    async (state) => {
      const { auth } = await createTestAuth({ registrationOpen: true });
      const cookie = await signInVerified(auth);
      await database
        .update(user)
        .set(
          state === "banned"
            ? { banned: true }
            : { deletionPendingAt: new Date() },
        )
        .where(eq(user.email, signUpBody.email));
      expect(await database.select().from(session)).toHaveLength(1);
      vi.mocked(getAuth).mockResolvedValue(auth);

      await expect(requireSession(new Headers({ cookie }))).rejects.toThrow(
        "redirect:/auth/sign-in",
      );
    },
  );

  test.each(["banned", "deleting"])(
    "Better Auth rejects retained %s sessions for API reads and sensitive endpoints",
    async (state) => {
      const { auth, jobs } = await createTestAuth({ registrationOpen: true });
      const cookie = await signInVerified(auth);
      const headers = new Headers({ cookie });
      expect(await auth.api.getSession({ headers })).not.toBeNull();
      await database
        .update(user)
        .set(
          state === "banned"
            ? { banned: true }
            : { deletionPendingAt: new Date() },
        )
        .where(eq(user.email, signUpBody.email));

      expect((await auth.api.getSession({ headers })) === null).toBe(true);
      const deletion = post("/delete-user", { callbackURL: "/goodbye" });
      deletion.headers.set("cookie", cookie);
      expect((await auth.handler(deletion)).status).toBe(401);
      expect(jobs.some((job) => job.kind === "delete-account")).toBe(false);
    },
  );

  test("a publishing administrator is locked immediately then purged without changing the public snapshot", async () => {
    const { auth } = await createTestAuth({ registrationOpen: true });
    const cookie = await signInVerified(auth);
    const [administrator] = await database
      .update(user)
      .set({ role: "admin" })
      .where(eq(user.email, signUpBody.email))
      .returning();
    const service = createCharacterService({
      database,
      actor: {
        userId: administrator.id,
        label: administrator.email,
        operationId: "publish-then-delete",
      },
    });
    const created = await service.createCharacter({
      slug: "retained-publisher",
      content: OFFICIAL_CHARACTER_SEEDS[0].content,
    });
    const published = await service.publishDraft({
      characterId: created.characterId,
      expectedRevision: created.draftRevision,
    });
    const [snapshot] = await database
      .select()
      .from(characterVersion)
      .where(eq(characterVersion.id, published.versionId));
    const now = new Date();
    const deletion = await requestAccountDeletion(database, {
      userId: administrator.id,
      email: administrator.email,
      now,
    });
    await confirmAccountDeletion(database, {
      token: deletion.verificationToken,
      now,
    });
    expect((await countPersistedAuthRecords()).userCount).toBe(1);
    expect(
      await auth.api.getSession({ headers: new Headers({ cookie }) }),
    ).toBeNull();
    vi.mocked(getAuth).mockResolvedValue(auth as never);
    await expect(requireSession(new Headers({ cookie }))).rejects.toThrow(
      "redirect:/auth/sign-in",
    );
    while (
      (await processAccountPurgeStage(database, deletion.requestId, now)) ===
      "continue"
    ) {}
    expect(await countPersistedAuthRecords()).toEqual({
      userCount: 0,
      credentialAccountCount: 0,
    });
    expect(await database.select().from(session)).toHaveLength(0);
    expect(
      await database
        .select()
        .from(characterVersion)
        .where(eq(characterVersion.id, published.versionId)),
    ).toEqual([snapshot]);
    expect(snapshot.publishedBy).toBe(administrator.id);
  });

  test("direct Better Auth deletion completion is disabled and cannot bypass staged purge", async () => {
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
    expect(response.status).toBe(404);
    const body = await response.text();
    expect(body).not.toMatch(/sent|private-session/);
    expect((await countPersistedAuthRecords()).userCount).toBe(1);
  });

  test("deletion-pending recovery/verification endpoints are indistinguishable from an unknown account and create no verification content", async () => {
    const { auth, jobs } = await createTestAuth({ registrationOpen: true });
    await signInVerified(auth);
    await database
      .update(user)
      .set({ deletionPendingAt: new Date() })
      .where(eq(user.email, signUpBody.email));
    for (const path of [
      "/request-password-reset",
      "/send-verification-email",
    ]) {
      const pending = await auth.handler(
        post(path, { email: signUpBody.email }),
      );
      const missing = await auth.handler(
        post(path, { email: "missing@example.com" }, "192.0.2.11"),
      );
      expect(pending.status).toBe(missing.status);
      expect(await pending.json()).toEqual(await missing.json());
    }
    expect(await database.select().from(verification)).toHaveLength(0);
    expect(jobs.filter((job) => job.kind === "reset-password")).toHaveLength(0);
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

  async function impersonatingSession(auth: ReturnType<typeof createAuth>) {
    const adminCookie = await signInVerified(auth);
    const [administrator] = await database
      .update(user)
      .set({ role: "admin" })
      .where(eq(user.email, signUpBody.email))
      .returning();
    await database.insert(user).values({
      id: "impersonation-target",
      name: "Target",
      email: "impersonation-target@example.com",
      emailVerified: true,
      role: "user",
    });
    const request = post("/admin/impersonate-user", {
      userId: "impersonation-target",
    });
    request.headers.set("cookie", adminCookie);
    const response = await auth.handler(request);
    expect(response.status).toBe(200);
    const cookies = new Map<string, string>();
    for (const item of response.headers.getSetCookie()) {
      const pair = item.split(";")[0];
      cookies.set(pair.slice(0, pair.indexOf("=")), pair);
    }
    const cookie = [...cookies.values()].join("; ");
    expect(
      (await auth.api.getSession({ headers: new Headers({ cookie }) }))?.user
        .id,
    ).toBe("impersonation-target");
    return { administrator, cookie };
  }

  test.each(["pending", "deleted", "banned"])(
    "retained impersonation cookie rejects a %s impersonator at API and page boundaries",
    async (state) => {
      const { auth } = await createTestAuth({ registrationOpen: true });
      const { administrator, cookie } = await impersonatingSession(auth);
      if (state === "deleted")
        await database.delete(user).where(eq(user.id, administrator.id));
      else
        await database
          .update(user)
          .set(
            state === "pending"
              ? { deletionPendingAt: new Date() }
              : { banned: true },
          )
          .where(eq(user.id, administrator.id));
      const headers = new Headers({ cookie });
      expect(await auth.api.getSession({ headers })).toBeNull();
      vi.mocked(getAuth).mockResolvedValue(auth);
      await expect(requireSession(headers)).rejects.toThrow(
        "redirect:/auth/sign-in",
      );
    },
  );

  test.each(["pending", "deleted"])(
    "impersonation insertion paused across %s impersonator deletion cannot commit",
    async (state) => {
      const { auth } = await createTestAuth({ registrationOpen: true });
      const { administrator } = await impersonatingSession(auth);
      const now = new Date();
      const requested = await requestAccountDeletion(database, {
        userId: administrator.id,
        email: administrator.email,
        now,
      });
      const inserting = createDatabase(databaseUrl, {
        application_name: "impersonation-insertion-race",
      });
      await database.execute(sql`
        CREATE FUNCTION task10_pause_impersonation() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.id = 'late-impersonation' THEN
            PERFORM pg_advisory_xact_lock(hashtextextended('task10-impersonation', 0));
          END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER a_task10_pause_impersonation BEFORE INSERT ON session
        FOR EACH ROW EXECUTE FUNCTION task10_pause_impersonation()
      `);
      let insertion: Promise<boolean> | undefined;
      try {
        await database.transaction(async (tx) => {
          await tx.execute(sql`
            SELECT pg_advisory_xact_lock(hashtextextended('task10-impersonation', 0))
          `);
          insertion = inserting
            .insert(session)
            .values({
              id: "late-impersonation",
              token: leakedToken,
              userId: "impersonation-target",
              impersonatedBy: administrator.id,
              expiresAt: new Date(Date.now() + 86_400_000),
            })
            .then(
              () => true,
              () => false,
            );
          await waitForDatabaseLock("impersonation-insertion-race");
          await confirmAccountDeletion(database, {
            token: requested.verificationToken,
            now,
          });
          if (state === "deleted")
            while (
              (await processAccountPurgeStage(
                database,
                requested.requestId,
                now,
              )) === "continue"
            ) {}
        });
        expect(await insertion).toBe(false);
        expect(
          await database
            .select()
            .from(session)
            .where(eq(session.impersonatedBy, administrator.id)),
        ).toHaveLength(0);
      } finally {
        await insertion;
        await database.execute(sql`
          DROP TRIGGER a_task10_pause_impersonation ON session;
          DROP FUNCTION task10_pause_impersonation()
        `);
        await inserting.$client.end();
      }
    },
  );

  test.each(["/request-password-reset", "/send-verification-email"])(
    "recovery lookup paused across final purge leaves no verification or email private bytes: %s",
    async (path) => {
      const output = vi.spyOn(console, "error").mockImplementation(() => {});
      const { auth } = await createTestAuth({
        registrationOpen: true,
        emailQueue: createEmailQueue(boss),
      });
      await auth.handler(post("/sign-up/email", signUpBody));
      const [owner] = await database.select().from(user);
      const now = new Date();
      const requested = await requestAccountDeletion(database, {
        userId: owner.id,
        email: owner.email,
        now,
      });
      const context = await auth.$context;
      const original = context.internalAdapter.findUserByEmail.bind(
        context.internalAdapter,
      );
      let release!: () => void;
      let entered!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      let lookups = 0;
      vi.spyOn(context.internalAdapter, "findUserByEmail").mockImplementation(
        async (...args) => {
          const result = await original(...args);
          if (++lookups === 2) {
            entered();
            await gate;
          }
          return result;
        },
      );
      const recovering = auth.handler(post(path, { email: owner.email }));
      try {
        await started;
        await confirmAccountDeletion(database, {
          token: requested.verificationToken,
          now,
        });
        while (
          (await processAccountPurgeStage(
            database,
            requested.requestId,
            now,
          )) === "continue"
        ) {}
        release();
        const response = await recovering;
        const missing = await auth.handler(
          post(path, { email: "missing@example.com" }, "192.0.2.11"),
        );
        expect(response.status).toBe(missing.status);
        expect(await response.text()).toBe(await missing.text());
        expect(await database.select().from(verification)).toHaveLength(0);
        const jobs = await boss.findJobs<EmailQueueJob>(AUTH_EMAIL_QUEUE, {});
        expect(jobs.every((job) => job.data.kind === "noop")).toBe(true);
        expect(JSON.stringify(jobs)).not.toMatch(
          /person@example|reset-password:|private|actionUrl/,
        );
        expect(inspect(output.mock.calls)).not.toMatch(
          /Failed query|params:|person@example|reset-password:/,
        );
      } finally {
        release();
        await recovering;
      }
    },
  );

  test.each(["pending", "missing"])(
    "database rejects recovery verification for a %s authoritative owner",
    async (state) => {
      if (state === "pending")
        await database.insert(user).values({
          id: "recovery-owner",
          name: "Recovery",
          email: "recovery@example.com",
          deletionPendingAt: new Date(),
        });
      const accepted = await database
        .insert(verification)
        .values({
          id: "late-recovery",
          identifier: "reset-password:private-reset-token",
          value: "recovery-owner",
          expiresAt: new Date(Date.now() + 3_600_000),
        })
        .then(
          () => true,
          () => false,
        );
      expect(accepted).toBe(false);
      expect(await database.select().from(verification)).toHaveLength(0);
    },
  );

  test("verification update already holding its row cannot deadlock final purge or retain private content", async () => {
    const { auth } = await createTestAuth({ registrationOpen: true });
    await auth.handler(post("/sign-up/email", signUpBody));
    const [owner] = await database.select().from(user);
    const now = new Date();
    await database.insert(verification).values({
      id: "purge-racing-verification",
      identifier: "reset-password:private-reset-token",
      value: owner.id,
      expiresAt: new Date(now.getTime() + 3_600_000),
    });
    await boss.send(AUTH_EMAIL_QUEUE, {
      kind: "reset-password",
      to: owner.email,
      actionUrl: `${baseUrl}/reset-password?token=private-reset-token`,
    });
    const requested = await requestAccountDeletion(database, {
      userId: owner.id,
      email: owner.email,
      now,
    });
    await confirmAccountDeletion(database, {
      token: requested.verificationToken,
      now,
    });
    for (let stage = 0; stage < 5; stage++)
      expect(
        await processAccountPurgeStage(database, requested.requestId, now),
      ).toBe("continue");
    const updating = createDatabase(databaseUrl, {
      application_name: "verification-update-before-purge",
    });
    const purging = createDatabase(databaseUrl, {
      application_name: "purge-after-verification-update",
    });
    await database.execute(sql`
      CREATE FUNCTION task10_pause_verification_update() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN PERFORM pg_advisory_xact_lock(hashtextextended('task10-verification-update', 0)); RETURN NEW; END $$;
      CREATE TRIGGER a_task10_pause_verification_update BEFORE UPDATE ON verification
      FOR EACH ROW EXECUTE FUNCTION task10_pause_verification_update()
    `);
    let update: Promise<string> | undefined;
    let purge: Promise<string> | undefined;
    try {
      await database.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended('task10-verification-update', 0))`,
        );
        update = updating
          .transaction(async (updateTx) => {
            await updateTx.execute(sql`SET LOCAL deadlock_timeout = '100ms'`);
            await updateTx
              .update(verification)
              .set({ expiresAt: new Date(now.getTime() + 7_200_000) })
              .where(eq(verification.id, "purge-racing-verification"));
          })
          .then(
            () => "accepted",
            (error: unknown) => {
              const cause = error instanceof Error ? error.cause : undefined;
              return cause && typeof cause === "object" && "code" in cause
                ? String(cause.code)
                : "unexpected-error";
            },
          );
        await waitForDatabaseLock("verification-update-before-purge");
        purge = processAccountPurgeStage(purging, requested.requestId, now).catch(
          () => "failed",
        );
        await waitForDatabaseLock("purge-after-verification-update");
        const { rows } = await database.$client.query(
          `SELECT query, pg_blocking_pids(pid) @> ARRAY[
            (SELECT pid FROM pg_stat_activity WHERE application_name = $2 AND state = 'active')
          ] AS blocked_by_update FROM pg_stat_activity
          WHERE application_name = $1 AND state = 'active'`,
          [
            "purge-after-verification-update",
            "verification-update-before-purge",
          ],
        );
        expect(rows[0].query).toMatch(/delete from verification/i);
        expect(rows[0].blocked_by_update).toBe(true);
      });
      expect(await update).toBe("23514");
      expect(await purge).toBe("complete");
      expect(await database.select().from(verification)).toHaveLength(0);
      expect(await database.select().from(user)).toHaveLength(0);
      const jobs = await boss.findJobs<EmailQueueJob>(AUTH_EMAIL_QUEUE, {});
      expect(JSON.stringify(jobs)).not.toMatch(
        /person@example|private-reset-token|actionUrl/,
      );
    } finally {
      await Promise.allSettled([update, purge].filter(Boolean));
      await database.execute(sql`
        DROP TRIGGER a_task10_pause_verification_update ON verification;
        DROP FUNCTION task10_pause_verification_update()
      `);
      await updating.$client.end();
      await purging.$client.end();
    }
  });

  test.each([
    ["recovery", "pending"],
    ["recovery", "missing"],
    ["email", "pending"],
    ["email", "missing"],
  ])(
    "%s verification cannot be restored for a %s authoritative owner",
    async (kind, state) => {
      await database.insert(user).values({
        id: "verification-owner",
        name: "Owner",
        email: "verification@example.com",
      });
      await database.insert(verification).values({
        id: "retained-verification",
        identifier:
          kind === "recovery"
            ? "reset-password:private-token"
            : "verification@example.com",
        value: kind === "recovery" ? "verification-owner" : "private-token",
        expiresAt: new Date(0),
      });
      if (state === "pending")
        await database
          .update(user)
          .set({ deletionPendingAt: new Date() })
          .where(eq(user.id, "verification-owner"));
      else
        await database.delete(user).where(eq(user.id, "verification-owner"));
      await expect(
        database
          .update(verification)
          .set({ expiresAt: new Date(Date.now() + 3_600_000) })
          .where(eq(verification.id, "retained-verification")),
      ).rejects.toMatchObject({ cause: { code: "23514" } });
      expect(
        (await database.select().from(verification))[0].expiresAt,
      ).toEqual(new Date(0));
    },
  );

  test.each([
    ["recovery reassignment", { value: "other-verification-owner" }],
    ["recovery token rotation", { identifier: "reset-password:rotated-token" }],
    ["email owner removal", { identifier: "unowned-identifier" }],
    ["email token rotation", { value: "rotated-private-token" }],
  ])("verification update rejects %s", async (kind, mutation) => {
    await database.insert(user).values([
      {
        id: "verification-owner",
        name: "Owner",
        email: "verification@example.com",
      },
      {
        id: "other-verification-owner",
        name: "Other",
        email: "other@example.com",
      },
    ]);
    const original = {
      id: "immutable-verification",
      identifier: kind.startsWith("recovery")
        ? "reset-password:private-token"
        : "verification@example.com",
      value: kind.startsWith("recovery") ? "verification-owner" : "private-token",
      expiresAt: new Date(Date.now() + 3_600_000),
    };
    await database.insert(verification).values(original);
    await expect(
      database
        .update(verification)
        .set(mutation)
        .where(eq(verification.id, original.id)),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
    expect(await database.select().from(verification)).toMatchObject([original]);
  });

  test.each(["recovery", "email"])(
    "active %s verification can refresh without changing its private identity",
    async (kind) => {
      await database.insert(user).values({
        id: "verification-owner",
        name: "Owner",
        email: "verification@example.com",
      });
      await database.insert(verification).values({
        id: "active-verification",
        identifier:
          kind === "recovery"
            ? "reset-password:private-token"
            : "verification@example.com",
        value: kind === "recovery" ? "verification-owner" : "private-token",
        expiresAt: new Date(0),
      });
      const expiresAt = new Date(Date.now() + 3_600_000);
      await database
        .update(verification)
        .set({ expiresAt })
        .where(eq(verification.id, "active-verification"));
      expect((await database.select().from(verification))[0].expiresAt).toEqual(
        expiresAt,
      );
    },
  );

  test("Better Auth admin mutations cannot rewrite a pending target or publish its identity", async () => {
    const { auth } = await createTestAuth({ registrationOpen: true });
    const cookie = await signInVerified(auth);
    await database
      .update(user)
      .set({ role: "admin" })
      .where(eq(user.email, signUpBody.email));
    await database.insert(user).values({
      id: "pending-admin-target",
      name: "Pending",
      email: "pending-target@example.com",
      role: "user",
      deletionPendingAt: new Date(),
    });

    for (const [path, body] of [
      [
        "/admin/ban-user",
        { userId: "pending-admin-target", banReason: leakedToken },
      ],
      ["/admin/set-role", { userId: "pending-admin-target", role: "admin" }],
      [
        "/admin/update-user",
        { userId: "pending-admin-target", data: { name: leakedToken } },
      ],
    ] as const) {
      const request = post(path, body);
      request.headers.set("cookie", cookie);
      const response = await auth.handler(request);
      expect(response.status).toBe(403);
      expect(await response.text()).not.toMatch(
        /Failed query|params:|private-session/,
      );
    }
    expect(
      await database
        .select()
        .from(user)
        .where(eq(user.id, "pending-admin-target")),
    ).toMatchObject([
      {
        name: "Pending",
        role: "user",
        banned: false,
        banReason: null,
      },
    ]);
  });

  test("session refresh already holding its row cannot invert the canonical deletion locks", async () => {
    const { auth } = await createTestAuth({ registrationOpen: true });
    await signInVerified(auth);
    const [owner] = await database.select().from(user);
    const [retained] = await database.select().from(session);
    const now = new Date();
    const requested = await requestAccountDeletion(database, {
      userId: owner.id,
      email: owner.email,
      now,
    });
    const refreshing = createDatabase(databaseUrl, {
      application_name: "session-refresh-before-delete",
    });
    const confirming = createDatabase(databaseUrl, {
      application_name: "delete-after-session-refresh",
    });
    await database.execute(sql`
      CREATE FUNCTION task10_pause_session_refresh() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN PERFORM pg_advisory_xact_lock(hashtextextended('task10-session-refresh', 0)); RETURN NEW; END $$;
      CREATE TRIGGER a_task10_pause_session_refresh BEFORE UPDATE ON session
      FOR EACH ROW EXECUTE FUNCTION task10_pause_session_refresh()
    `);
    let refresh: Promise<boolean> | undefined;
    let confirmation: Promise<boolean> | undefined;
    try {
      await database.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended('task10-session-refresh', 0))`,
        );
        refresh = refreshing
          .update(session)
          .set({ updatedAt: now })
          .where(eq(session.id, retained.id))
          .then(
            () => true,
            () => false,
          );
        await waitForDatabaseLock("session-refresh-before-delete");
        confirmation = confirmAccountDeletion(confirming, {
          token: requested.verificationToken,
          now,
        }).then(
          () => true,
          () => false,
        );
        await waitForDatabaseLock("delete-after-session-refresh");
        const { rows } = await database.$client.query(
          "SELECT query FROM pg_stat_activity WHERE application_name = $1",
          ["delete-after-session-refresh"],
        );
        expect(rows[0].query).toMatch(/delete from "session"/i);
      });
      expect(await refresh).toBe(true);
      expect(await confirmation).toBe(true);
      expect(await database.select().from(session)).toHaveLength(0);
    } finally {
      await Promise.allSettled([refresh, confirmation].filter(Boolean));
      await database.execute(sql`
        DROP TRIGGER a_task10_pause_session_refresh ON session;
        DROP FUNCTION task10_pause_session_refresh()
      `);
      await refreshing.$client.end();
      await confirming.$client.end();
    }
  });

  test("session identity relationships cannot be reassigned by an update", async () => {
    const { auth } = await createTestAuth({ registrationOpen: true });
    const { administrator } = await impersonatingSession(auth);
    const accepted = await database
      .update(session)
      .set({ impersonatedBy: null })
      .where(eq(session.impersonatedBy, administrator.id))
      .then(
        () => true,
        () => false,
      );
    expect(accepted).toBe(false);
    expect(
      await database
        .select()
        .from(session)
        .where(eq(session.impersonatedBy, administrator.id)),
    ).toHaveLength(1);
  });

  test("impersonation API insertion delayed until final purge returns only a safe denial", async () => {
    const output = vi.spyOn(console, "error").mockImplementation(() => {});
    const { auth } = await createTestAuth({ registrationOpen: true });
    const cookie = await signInVerified(auth);
    const [administrator] = await database
      .update(user)
      .set({ role: "admin" })
      .where(eq(user.email, signUpBody.email))
      .returning();
    await database.insert(user).values({
      id: "delayed-api-target",
      name: "Target",
      email: "delayed-target@example.com",
      emailVerified: true,
      role: "user",
    });
    const context = await auth.$context;
    const original = context.internalAdapter.createSession.bind(
      context.internalAdapter,
    );
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    vi.spyOn(context.internalAdapter, "createSession").mockImplementation(
      async (...args) => {
        entered();
        await gate;
        return original(...args);
      },
    );
    const request = post("/admin/impersonate-user", {
      userId: "delayed-api-target",
    });
    request.headers.set("cookie", cookie);
    const impersonating = auth.handler(request);
    try {
      await started;
      const now = new Date();
      const requested = await requestAccountDeletion(database, {
        userId: administrator.id,
        email: administrator.email,
        now,
      });
      await confirmAccountDeletion(database, {
        token: requested.verificationToken,
        now,
      });
      while (
        (await processAccountPurgeStage(database, requested.requestId, now)) ===
        "continue"
      ) {}
      release();
      const response = await impersonating;
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        code: "BANNED_USER",
      });
      expect(response.headers.getSetCookie().join(";")).not.toMatch(
        /session_token=[^;]/,
      );
      expect(await database.select().from(session)).toHaveLength(0);
      expect(inspect(output.mock.calls)).not.toMatch(
        /Failed query|params:|session_token|person@example/,
      );
    } finally {
      release();
      await impersonating;
    }
  });

  test("impersonated session lookup queued behind confirmation rechecks both relationships", async () => {
    const reader = createDatabase(databaseUrl, {
      application_name: "impersonation-lookup-after-confirm",
    });
    const confirming = createDatabase(databaseUrl, {
      application_name: "impersonation-confirm-before-lookup",
    });
    const { auth } = await createTestAuth({
      registrationOpen: true,
      database: reader,
    });
    const { administrator, cookie } = await impersonatingSession(auth);
    const now = new Date();
    const requested = await requestAccountDeletion(database, {
      userId: administrator.id,
      email: administrator.email,
      now,
    });
    let confirmation: ReturnType<typeof confirmAccountDeletion> | undefined;
    let lookup: ReturnType<typeof auth.api.getSession> | undefined;
    try {
      await database.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT id FROM chat_settings WHERE id = 'global' FOR UPDATE`,
        );
        confirmation = confirmAccountDeletion(confirming, {
          token: requested.verificationToken,
          now,
        });
        await waitForDatabaseLock("impersonation-confirm-before-lookup");
        lookup = auth.api.getSession({ headers: new Headers({ cookie }) });
        await waitForDatabaseLock("impersonation-lookup-after-confirm");
      });
      await confirmation;
      expect(await lookup).toBeNull();
      expect(await database.select().from(session)).toHaveLength(0);
    } finally {
      await Promise.allSettled([confirmation, lookup].filter(Boolean));
      await reader.$client.end();
      await confirming.$client.end();
    }
  });

  test("Better Auth administrator removal cannot bypass the application purge owner", async () => {
    const { auth } = await createTestAuth({ registrationOpen: true });
    const cookie = await signInVerified(auth);
    await database
      .update(user)
      .set({ role: "admin" })
      .where(eq(user.email, signUpBody.email))
      .returning();
    await database.insert(user).values({
      id: "removal-target",
      name: "Target",
      email: "target@example.com",
    });
    const request = post("/admin/remove-user", { userId: "removal-target" });
    request.headers.set("cookie", cookie);
    const response = await auth.handler(request);
    expect(response.status).toBe(403);
    expect(await database.select().from(user)).toHaveLength(2);
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
