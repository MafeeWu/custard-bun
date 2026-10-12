// @vitest-environment node
import { afterAll, afterEach, beforeEach, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getAuth } from "@/server/auth/auth";
import { getDatabase } from "@/server/db/database";
import { createDatabase } from "@/server/db/client";
import { dataExportJob } from "@/server/db/schema";
import { testDatabaseUrl } from "@/test/database-target";
import {
  extractionNow,
  resetExtractionDatabase,
} from "@/test/memory-extraction-fixture";
import { summaryFixture } from "@/test/memory-summary-fixture";
import {
  expireDataExports,
  processDataExport,
  requestDataExport,
} from "@/server/privacy/data-export-service";
import * as snapshotService from "@/server/privacy/data-export-snapshot";
import { GET } from "./route";

vi.mock("@/server/auth/auth", () => ({ getAuth: vi.fn() }));
vi.mock("@/server/db/database", () => ({ getDatabase: vi.fn() }));

const database = createDatabase(testDatabaseUrl());
beforeEach(async () => {
  await resetExtractionDatabase(database);
  vi.mocked(getDatabase).mockResolvedValue(database);
});
afterEach(() => vi.useRealTimers());
afterAll(() => database.$client.end());

test.each(["owner download", "scheduled cleanup"])(
  "%s expires the real archive exactly 24 hours after publication",
  async (cleanup) => {
    const owner = await summaryFixture(database);
    const other = await summaryFixture(database);
    const publication = new Date(Date.now() + 60 * 60 * 1000);
    const expiry = new Date(publication.getTime() + 24 * 60 * 60 * 1000);
    let sessionUserId = owner.userId;
    vi.mocked(getAuth).mockResolvedValue({
      api: { getSession: async () => ({ user: { id: sessionUserId } }) },
    } as never);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(extractionNow);
    const { exportId } = await requestDataExport(database, {
      userId: owner.userId,
      now: new Date(),
    });
    const readSnapshot = snapshotService.readDataExportSnapshot;
    vi.spyOn(snapshotService, "readDataExportSnapshot").mockImplementation(
      async (...args) => {
        const archive = await readSnapshot(...args);
        vi.setSystemTime(publication);
        return archive;
      },
    );
    await processDataExport(database, exportId, extractionNow);
    const [completed] = await database.select().from(dataExportJob)
      .where(eq(dataExportJob.id, exportId));
    expect(completed.completedAt).toEqual(publication);
    expect(completed.expiresAt).toEqual(expiry);
    const download = () => GET(
      new Request(`http://localhost/account/exports/${exportId}/download`),
      { params: Promise.resolve({ id: exportId }) },
    );
    // The old dispatch-based deadline must not shorten the owner's availability.
    vi.setSystemTime(new Date("2026-10-11T08:00:00.000Z"));
    expect(await expireDataExports(database, new Date())).toBe(0);
    expect((await download()).status).toBe(200);
    sessionUserId = other.userId;
    expect((await download()).status).toBe(404);
    sessionUserId = owner.userId;
    vi.setSystemTime(new Date(expiry.getTime() - 1));
    const response = await download();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Content-Length")).toBe(String(completed.archiveSize));
    expect(Buffer.from(await response.arrayBuffer())).toEqual(completed.archiveBytes);
    vi.setSystemTime(expiry);
    if (cleanup === "scheduled cleanup")
      expect(await expireDataExports(database, new Date())).toBe(1);
    const expired = await download();
    expect(expired.status).toBe(404);
    expect(expired.headers.get("Cache-Control")).toBe("private, no-store");
    const [removed] = await database.select().from(dataExportJob)
      .where(eq(dataExportJob.id, exportId));
    expect(removed).toMatchObject({
      status: "expired",
      archiveBytes: null,
      archiveSize: null,
      archiveSha256: null,
      expiresAt: null,
    });
    expect(await expireDataExports(database, new Date())).toBe(0);
  },
);
