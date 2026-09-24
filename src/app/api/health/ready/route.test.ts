// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRuntimeConfig: vi.fn(),
  createDatabase: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
  requireRecentWorkerHeartbeat: vi.fn(),
}));

vi.mock("@/server/config/load-config", () => ({
  getRuntimeConfig: mocks.getRuntimeConfig,
}));

vi.mock("@/server/db/client", () => ({
  createDatabase: mocks.createDatabase,
}));

vi.mock("@/server/health/worker-heartbeat", () => ({
  requireRecentWorkerHeartbeat: mocks.requireRecentWorkerHeartbeat,
}));

import { GET } from "./route";

beforeEach(() => {
  mocks.createDatabase.mockReturnValue({
    $client: {
      query: mocks.query,
      end: mocks.end,
    },
  });
  mocks.getRuntimeConfig.mockResolvedValue({
    secret: { databaseUrl: "postgresql://hidden:secret@db/app" },
  });
  mocks.query.mockResolvedValue(undefined);
  mocks.end.mockResolvedValue(undefined);
  mocks.requireRecentWorkerHeartbeat.mockResolvedValue(undefined);
});

test("returns 200 only when database and worker are ready", async () => {
  const response = await GET();

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    ready: true,
    checks: { database: "ok", worker: "ok" },
  });
  expect(mocks.query).toHaveBeenCalledWith("select 1");
  expect(mocks.requireRecentWorkerHeartbeat).toHaveBeenCalledWith(
    expect.anything(),
    "auth-email-worker",
    expect.any(Date),
  );
  expect(mocks.end).toHaveBeenCalledOnce();
});

test("uses bounded PostgreSQL connection and query timeouts", async () => {
  await GET();

  expect(mocks.createDatabase).toHaveBeenCalledWith(
    expect.any(String),
    {
      connectionTimeoutMillis: 1_000,
      query_timeout: 1_000,
      statement_timeout: 1_000,
    },
  );
});

test("returns a redacted 503 when runtime configuration cannot load", async () => {
  mocks.getRuntimeConfig.mockRejectedValueOnce(
    new Error("BETTER_AUTH_SECRET=private-value"),
  );

  const response = await GET();
  const body = await response.json();

  expect(response.status).toBe(503);
  expect(body).toEqual({
    ready: false,
    checks: { database: "error", worker: "error" },
  });
  expect(JSON.stringify(body)).not.toContain("private-value");
  expect(mocks.end).not.toHaveBeenCalled();
});

test("reports database failure when closing the readiness pool fails", async () => {
  mocks.end.mockRejectedValueOnce(new Error("private pool detail"));

  const response = await GET();

  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    ready: false,
    checks: { database: "error", worker: "ok" },
  });
});

test("returns 503 and closes the database when a dependency fails", async () => {
  mocks.query.mockRejectedValueOnce(
    new Error("postgresql://hidden:secret@db/app refused"),
  );

  const response = await GET();
  const body = await response.json();

  expect(response.status).toBe(503);
  expect(body).toEqual({
    ready: false,
    checks: { database: "error", worker: "ok" },
  });
  expect(JSON.stringify(body)).not.toContain("secret");
  expect(mocks.end).toHaveBeenCalledOnce();
});
