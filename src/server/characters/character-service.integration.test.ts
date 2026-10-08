// @vitest-environment node
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { AdminActor } from "@/server/admin/admin-actor";
import type { CharacterContent } from "@/server/characters/character-content";
import { CharacterDomainError } from "@/server/characters/character-errors";
import { characterContentDigest } from "@/server/characters/content-digest";
import { adminAuditEvent, user } from "@/server/db/schema";
import {
  character,
  characterDraft,
  characterVersion,
} from "@/server/db/character-schema";
import { createDatabase } from "@/server/db/client";
import { testDatabaseUrl } from "@/test/database-target";
import { createCharacterService } from "./character-service";

const database = createDatabase(testDatabaseUrl());

const actor: AdminActor = {
  userId: "admin-1",
  label: "admin@example.com",
  operationId: "op-character-service",
};

const validContent: CharacterContent = {
  displayName: "Mira",
  avatarPath: "/characters/mira.svg",
  shortDescription: "A calm, attentive companion.",
  longDescription: "Mira listens carefully and responds without rushing.",
  personalityPrinciples: ["Listen before advising.", "Name uncertainty."],
  speakingStyle: "Warm, direct, and unhurried.",
  responseRhythm: "Usually two short paragraphs followed by one question.",
  relationshipBoundaries: [
    "Never claim consciousness.",
    "Do not encourage dependency.",
  ],
  openingMessage: "What would feel useful to talk through today?",
  exampleConversations: [
    {
      user: "I had a difficult day.",
      assistant: "I am here. Which part is weighing on you most?",
    },
  ],
  generationParameters: {
    temperature: 0.7,
    topP: 0.9,
    maxOutputTokens: 800,
  },
  safetyAdditions: ["Use grounding language when the user sounds overwhelmed."],
};

function contentWith(overrides: Partial<CharacterContent>): CharacterContent {
  return {
    ...validContent,
    ...overrides,
  };
}

function createService(
  options: {
    serviceActor?: AdminActor;
    verifyAvatarAsset?: (avatarPath: string) => Promise<void>;
  } = {},
) {
  return createCharacterService({
    database,
    actor: options.serviceActor ?? actor,
    verifyAvatarAsset:
      options.verifyAvatarAsset ?? vi.fn(async () => undefined),
  });
}

async function insertAdminUser(): Promise<void> {
  await database.insert(user).values({
    id: actor.userId,
    name: "Admin",
    email: actor.label,
    emailVerified: true,
    role: "admin",
  });
}

async function auditEvents(action?: string) {
  const rows = await database
    .select()
    .from(adminAuditEvent)
    .orderBy(adminAuditEvent.createdAt);
  return action ? rows.filter((row) => row.action === action) : rows;
}

async function expectOneAuditEvent(input: {
  action: string;
  targetId: string;
  metadata?: Record<string, unknown>;
}) {
  const rows = await auditEvents(input.action);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    actorUserId: actor.userId,
    actorLabel: actor.label,
    action: input.action,
    targetType: "character",
    targetId: input.targetId,
    operationId: actor.operationId,
  });
  if (input.metadata) {
    expect(rows[0].metadata).toMatchObject(input.metadata);
  }
}

async function expectCharacterError(
  promise: Promise<unknown>,
  code: CharacterDomainError["code"],
): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code });
}

async function getDraft(characterId: string) {
  const [draft] = await database
    .select()
    .from(characterDraft)
    .where(eq(characterDraft.characterId, characterId));
  return draft;
}

async function getCharacter(characterId: string) {
  const [row] = await database
    .select()
    .from(character)
    .where(eq(character.id, characterId));
  return row;
}

async function getVersions(characterId: string) {
  return database
    .select()
    .from(characterVersion)
    .where(eq(characterVersion.characterId, characterId))
    .orderBy(characterVersion.versionNumber);
}

async function waitForApplicationLockWait(
  applicationName: string,
): Promise<void> {
  const deadline = Date.now() + 2_000;

  while (Date.now() < deadline) {
    const result = await database.$client.query<{
      wait_event_type: string | null;
    }>(
      `
        SELECT wait_event_type
        FROM pg_stat_activity
        WHERE application_name = $1
          AND state = 'active'
      `,
      [applicationName],
    );

    if (result.rows.some((row) => row.wait_event_type === "Lock")) {
      return;
    }

    await delay(10);
  }

  throw new Error(`${applicationName} did not wait on a PostgreSQL lock`);
}

async function deleteAuditEvents(): Promise<void> {
  await database.delete(adminAuditEvent);
}

beforeEach(async () => {
  await database.execute(
    sql.raw(`
    TRUNCATE TABLE
      admin_audit_events,
      character_drafts,
      character_versions,
      characters,
      "user"
    RESTART IDENTITY CASCADE
  `),
  );
  await insertAdminUser();
});

afterAll(async () => {
  await database.$client.end();
});

describe("createCharacter", () => {
  test("inserts a stable character, revision-1 draft, and one audit event", async () => {
    const service = createService();

    const result = await service.createCharacter({
      slug: "mira",
      content: validContent,
    });

    expect(result).toEqual({
      characterId: expect.any(String),
      draftRevision: 1,
    });
    expect(await getCharacter(result.characterId)).toMatchObject({
      id: result.characterId,
      slug: "mira",
      lifecycle: "active",
      defaultVersionId: null,
      createdBy: actor.userId,
    });
    expect(await getDraft(result.characterId)).toMatchObject({
      characterId: result.characterId,
      revision: 1,
      baseVersionId: null,
      displayName: validContent.displayName,
      updatedBy: actor.userId,
    });
    await expectOneAuditEvent({
      action: "character.create",
      targetId: result.characterId,
      metadata: { slug: "mira", revision: 1 },
    });
  });

  test("duplicate slug fails without partial rows", async () => {
    const service = createService();
    await service.createCharacter({ slug: "mira", content: validContent });

    await expect(
      service.createCharacter({
        slug: "mira",
        content: contentWith({ displayName: "Duplicate Mira" }),
      }),
    ).rejects.toThrow();

    expect(await database.select().from(character)).toHaveLength(1);
    expect(await database.select().from(characterDraft)).toHaveLength(1);
    expect(await auditEvents()).toHaveLength(1);
  });
});

describe("saveDraft", () => {
  test("stale expectedRevision throws DRAFT_CONFLICT", async () => {
    const service = createService();
    const created = await service.createCharacter({
      slug: "mira",
      content: validContent,
    });
    await service.saveDraft({
      characterId: created.characterId,
      expectedRevision: 1,
      content: contentWith({ displayName: "Mira Updated" }),
    });

    await expectCharacterError(
      service.saveDraft({
        characterId: created.characterId,
        expectedRevision: 1,
        content: contentWith({ displayName: "Mira Stale" }),
      }),
      "DRAFT_CONFLICT",
    );

    expect(await getDraft(created.characterId)).toMatchObject({
      revision: 2,
      displayName: "Mira Updated",
    });
    const saveAudits = await auditEvents("character.draft.save");
    expect(saveAudits).toHaveLength(1);
    expect(saveAudits[0].metadata).toMatchObject({
      revision: 2,
      changedFields: "displayName",
    });
  });

  test("two concurrent saves using one revision yield one success and one conflict", async () => {
    const service = createService();
    const created = await service.createCharacter({
      slug: "mira",
      content: validContent,
    });

    const results = await Promise.allSettled([
      service.saveDraft({
        characterId: created.characterId,
        expectedRevision: 1,
        content: contentWith({ displayName: "Mira First" }),
      }),
      service.saveDraft({
        characterId: created.characterId,
        expectedRevision: 1,
        content: contentWith({ displayName: "Mira Second" }),
      }),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toBeDefined();
    expect((rejected as PromiseRejectedResult).reason).toMatchObject({
      code: "DRAFT_CONFLICT",
    });
    expect(await getDraft(created.characterId)).toMatchObject({ revision: 2 });
    expect(await auditEvents("character.draft.save")).toHaveLength(1);
  });
});

describe("publishDraft", () => {
  test("verifies the avatar, inserts immutable v1, advances draft base and revision, and does not set default", async () => {
    const verifyAvatarAsset = vi.fn(async () => undefined);
    const service = createService({ verifyAvatarAsset });
    const created = await service.createCharacter({
      slug: "mira",
      content: validContent,
    });

    const published = await service.publishDraft({
      characterId: created.characterId,
      expectedRevision: 1,
    });

    expect(verifyAvatarAsset).toHaveBeenCalledExactlyOnceWith(
      validContent.avatarPath,
    );
    expect(published).toEqual({
      versionId: expect.any(String),
      versionNumber: 1,
      draftRevision: 2,
    });
    const [version] = await getVersions(created.characterId);
    expect(version).toMatchObject({
      id: published.versionId,
      characterId: created.characterId,
      versionNumber: 1,
      displayName: validContent.displayName,
      contentDigest: characterContentDigest(validContent),
      publishedBy: actor.userId,
    });
    expect(await getDraft(created.characterId)).toMatchObject({
      revision: 2,
      baseVersionId: published.versionId,
    });
    expect(await getCharacter(created.characterId)).toMatchObject({
      defaultVersionId: null,
    });
    await expectOneAuditEvent({
      action: "character.version.publish",
      targetId: created.characterId,
      metadata: { versionNumber: 1 },
    });
  });

  test("unchanged re-publication throws UNCHANGED_DRAFT", async () => {
    const service = createService();
    const created = await service.createCharacter({
      slug: "mira",
      content: validContent,
    });
    await service.publishDraft({
      characterId: created.characterId,
      expectedRevision: 1,
    });

    await expectCharacterError(
      service.publishDraft({
        characterId: created.characterId,
        expectedRevision: 2,
      }),
      "UNCHANGED_DRAFT",
    );

    expect(await getVersions(created.characterId)).toHaveLength(1);
    expect(await auditEvents("character.version.publish")).toHaveLength(1);
  });

  test("two concurrent publications from one revision yield one success and one DRAFT_CONFLICT without duplicate version numbers", async () => {
    const service = createService();
    const created = await service.createCharacter({
      slug: "mira",
      content: validContent,
    });

    const results = await Promise.allSettled([
      service.publishDraft({
        characterId: created.characterId,
        expectedRevision: 1,
      }),
      service.publishDraft({
        characterId: created.characterId,
        expectedRevision: 1,
      }),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toBeDefined();
    expect((rejected as PromiseRejectedResult).reason).toMatchObject({
      code: "DRAFT_CONFLICT",
    });
    const versions = await getVersions(created.characterId);
    expect(versions.map((version) => version.versionNumber)).toEqual([1]);
    expect(await getDraft(created.characterId)).toMatchObject({ revision: 2 });
    expect(await auditEvents("character.version.publish")).toHaveLength(1);
  });
});

describe("setDefaultVersion and lifecycle", () => {
  test("setting another character's version throws INVALID_DEFAULT_VERSION", async () => {
    const service = createService();
    const first = await service.createCharacter({
      slug: "mira",
      content: validContent,
    });
    const second = await service.createCharacter({
      slug: "sol",
      content: contentWith({
        displayName: "Sol",
        avatarPath: "/characters/sol.svg",
      }),
    });
    const secondVersion = await service.publishDraft({
      characterId: second.characterId,
      expectedRevision: 1,
    });

    await expectCharacterError(
      service.setDefaultVersion({
        characterId: first.characterId,
        versionId: secondVersion.versionId,
      }),
      "INVALID_DEFAULT_VERSION",
    );

    expect(await getCharacter(first.characterId)).toMatchObject({
      defaultVersionId: null,
    });
    expect(await auditEvents("character.default.change")).toHaveLength(0);
  });

  test("archive and restore retain draft, versions, and default pointer; repeated state is invalid", async () => {
    const service = createService();
    const created = await service.createCharacter({
      slug: "mira",
      content: validContent,
    });
    const published = await service.publishDraft({
      characterId: created.characterId,
      expectedRevision: 1,
    });
    await service.setDefaultVersion({
      characterId: created.characterId,
      versionId: published.versionId,
    });

    await service.setArchived({
      characterId: created.characterId,
      archived: true,
    });
    await expectCharacterError(
      service.setArchived({ characterId: created.characterId, archived: true }),
      "INVALID_CHARACTER_STATE",
    );
    await service.setArchived({
      characterId: created.characterId,
      archived: false,
    });
    await expectCharacterError(
      service.setArchived({
        characterId: created.characterId,
        archived: false,
      }),
      "INVALID_CHARACTER_STATE",
    );

    expect(await getCharacter(created.characterId)).toMatchObject({
      lifecycle: "active",
      defaultVersionId: published.versionId,
    });
    expect(await getDraft(created.characterId)).toMatchObject({
      characterId: created.characterId,
      baseVersionId: published.versionId,
      revision: 2,
    });
    expect(await getVersions(created.characterId)).toHaveLength(1);
    expect(await auditEvents("character.default.change")).toHaveLength(1);
    expect(await auditEvents("character.archive")).toHaveLength(1);
    expect(await auditEvents("character.restore")).toHaveLength(1);
  });

  test("two concurrent same-state archive calls yield one success, one invalid state, and one audit event", async () => {
    const setupService = createService();
    const created = await setupService.createCharacter({
      slug: "mira",
      content: validContent,
    });
    await deleteAuditEvents();

    const firstDatabase = createDatabase(testDatabaseUrl(), {
      application_name: "character-archive-first",
      max: 1,
    });
    const secondDatabase = createDatabase(testDatabaseUrl(), {
      application_name: "character-archive-second",
      max: 1,
    });
    const firstService = createCharacterService({
      database: firstDatabase,
      actor,
      verifyAvatarAsset: vi.fn(async () => undefined),
    });
    const secondService = createCharacterService({
      database: secondDatabase,
      actor,
      verifyAvatarAsset: vi.fn(async () => undefined),
    });
    const locker = await database.$client.connect();

    try {
      await locker.query("BEGIN");
      await locker.query("SELECT id FROM characters WHERE id = $1 FOR UPDATE", [
        created.characterId,
      ]);

      const firstArchive = firstService.setArchived({
        characterId: created.characterId,
        archived: true,
      });
      await waitForApplicationLockWait("character-archive-first");

      const secondArchive = secondService.setArchived({
        characterId: created.characterId,
        archived: true,
      });
      await waitForApplicationLockWait("character-archive-second");

      await locker.query("COMMIT");

      const results = await Promise.allSettled([firstArchive, secondArchive]);
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      const rejected = results.find((result) => result.status === "rejected");
      expect(rejected).toBeDefined();
      expect((rejected as PromiseRejectedResult).reason).toMatchObject({
        code: "INVALID_CHARACTER_STATE",
      });
      expect(await getCharacter(created.characterId)).toMatchObject({
        lifecycle: "archived",
      });
      expect(await auditEvents("character.archive")).toHaveLength(1);
    } finally {
      await locker.query("ROLLBACK").catch(() => undefined);
      locker.release();
      await firstDatabase.$client.end();
      await secondDatabase.$client.end();
    }
  });

  test("concurrent default changes serialize previous version audit metadata in lock order", async () => {
    const setupService = createService();
    const created = await setupService.createCharacter({
      slug: "mira",
      content: validContent,
    });
    const versionOne = await setupService.publishDraft({
      characterId: created.characterId,
      expectedRevision: 1,
    });
    const draftForVersionTwo = await setupService.saveDraft({
      characterId: created.characterId,
      expectedRevision: 2,
      content: contentWith({ displayName: "Mira v2" }),
    });
    const versionTwo = await setupService.publishDraft({
      characterId: created.characterId,
      expectedRevision: draftForVersionTwo.draftRevision,
    });
    const draftForVersionThree = await setupService.saveDraft({
      characterId: created.characterId,
      expectedRevision: versionTwo.draftRevision,
      content: contentWith({ displayName: "Mira v3" }),
    });
    const versionThree = await setupService.publishDraft({
      characterId: created.characterId,
      expectedRevision: draftForVersionThree.draftRevision,
    });
    await setupService.setDefaultVersion({
      characterId: created.characterId,
      versionId: versionOne.versionId,
    });
    await deleteAuditEvents();

    const firstDatabase = createDatabase(testDatabaseUrl(), {
      application_name: "character-default-v2",
      max: 1,
    });
    const secondDatabase = createDatabase(testDatabaseUrl(), {
      application_name: "character-default-v3",
      max: 1,
    });
    const firstService = createCharacterService({
      database: firstDatabase,
      actor,
      verifyAvatarAsset: vi.fn(async () => undefined),
    });
    const secondService = createCharacterService({
      database: secondDatabase,
      actor,
      verifyAvatarAsset: vi.fn(async () => undefined),
    });
    const locker = await database.$client.connect();

    try {
      await locker.query("BEGIN");
      await locker.query("SELECT id FROM characters WHERE id = $1 FOR UPDATE", [
        created.characterId,
      ]);

      const setVersionTwoDefault = firstService.setDefaultVersion({
        characterId: created.characterId,
        versionId: versionTwo.versionId,
      });
      await waitForApplicationLockWait("character-default-v2");

      const setVersionThreeDefault = secondService.setDefaultVersion({
        characterId: created.characterId,
        versionId: versionThree.versionId,
      });
      await waitForApplicationLockWait("character-default-v3");

      await locker.query("COMMIT");

      const results = await Promise.allSettled([
        setVersionTwoDefault,
        setVersionThreeDefault,
      ]);
      expect(results).toEqual([
        expect.objectContaining({ status: "fulfilled" }),
        expect.objectContaining({ status: "fulfilled" }),
      ]);
      expect(await getCharacter(created.characterId)).toMatchObject({
        defaultVersionId: versionThree.versionId,
      });

      const defaultAudits = await auditEvents("character.default.change");
      expect(defaultAudits).toHaveLength(2);
      expect(defaultAudits.map((event) => event.metadata)).toEqual([
        { previousVersionNumber: 1, newVersionNumber: 2 },
        { previousVersionNumber: 2, newVersionNumber: 3 },
      ]);
    } finally {
      await locker.query("ROLLBACK").catch(() => undefined);
      locker.release();
      await firstDatabase.$client.end();
      await secondDatabase.$client.end();
    }
  });
});

describe("transaction boundaries", () => {
  test("forced audit insertion failure rolls back the business mutation", async () => {
    const service = createService({
      serviceActor: {
        ...actor,
        label: null as never,
      },
    });

    await expect(
      service.createCharacter({ slug: "mira", content: validContent }),
    ).rejects.toThrow();

    expect(await database.select().from(character)).toHaveLength(0);
    expect(await database.select().from(characterDraft)).toHaveLength(0);
    expect(await database.select().from(adminAuditEvent)).toHaveLength(0);
  });
});
