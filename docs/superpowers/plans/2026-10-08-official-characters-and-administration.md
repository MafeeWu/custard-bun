# Official Characters and Administration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a public catalog of five official characters plus a secure administration area for immutable character publishing, ordinary-user disable/restore controls, and durable audit events.

**Architecture:** Extend the existing Next.js modular monolith with a focused character domain: strict content schemas, one mutable draft per stable character, append-only published snapshots, transactional services, and public/admin query boundaries. Reuse Better Auth identity tables for administrator authorization and user disabling, keep PostgreSQL as the only stateful dependency, and make the deployment migration command seed missing official characters without overwriting administrator state.

**Tech Stack:** Node.js 24.x, pnpm 12.5.1, Next.js 16.3.6, React 19.3.0, TypeScript 7.0.2, Better Auth 1.7.5, Drizzle ORM 0.45.3, PostgreSQL 16, Zod 4.6.5, Vitest 5.0.1, Testing Library 16.3.3, Playwright 1.63.0, Tailwind CSS 4.3.3.

**Spec:** `docs/superpowers/specs/2026-10-08-official-characters-and-administration-design.md`

## Global Constraints

- The application remains a TypeScript and Next.js modular monolith.
- PostgreSQL remains the only required stateful production dependency.
- Characters are official content managed by administrators; users cannot create or publish characters.
- The catalog and character detail pages are publicly readable.
- Each character has at most one mutable draft.
- Publishing produces an immutable snapshot and never automatically changes the default version.
- Archived characters are unavailable for new selections but do not invalidate pinned published versions.
- Avatar files are deployer-provided site-relative assets; do not add uploads, remote URLs, or object storage.
- Administrator roles remain deployment-CLI managed; the web UI manages ordinary users only.
- Do not add model calls, conversations, messages, long-term memory, temporary bans, public version history, voice, image generation, RAG, plugins, billing, or relationship levels.
- Every administration page and mutation uses server-side session and role validation.
- Every explicit administrative write records an audit event in the same database transaction.
- Operational logs and audit metadata exclude full character packages, disable-reason text, authentication secrets, and private user content.
- Preserve the existing loopback PostgreSQL and `_test` destructive-test safety boundary.

## Review Focus

- Reject avatar traversal, query/fragment suffixes, unsupported extensions, and missing files before publication; cover this in Task 1 schema tests and Task 4 publication tests.
- Resolve concurrent draft saves and concurrent publication deterministically without lost updates or duplicate version numbers; cover this in Task 4 integration tests.
- Reject a default version belonging to another character at both service and database levels; cover this in Tasks 2 and 4.
- Re-running seed deployment must not restore an archived seed or overwrite its draft, versions, or default pointer; cover this in Task 5 integration tests.
- An administrator must not disable itself or another administrator, while disabling an ordinary user must revoke all sessions atomically; cover this in Task 8 integration and end-to-end tests.

---

## File Structure

Create and modify these focused units:

```text
public/characters/
├── action-coach.svg
├── calm-listener.svg
├── creative-storyteller.svg
├── energetic-friend.svg
└── rational-companion.svg

src/app/
├── app/page.tsx
├── characters/page.tsx
├── characters/[slug]/page.tsx
├── admin/layout.tsx
├── admin/page.tsx
├── admin/characters/page.tsx
├── admin/characters/new/page.tsx
├── admin/characters/[id]/page.tsx
├── admin/characters/[id]/preview/page.tsx
├── admin/users/page.tsx
└── admin/audit/page.tsx

src/components/characters/
├── character-card.tsx
└── character-profile.tsx

src/components/admin/characters/
├── character-editor.tsx
├── character-preview.tsx
└── version-history.tsx

src/components/admin/users/
└── user-status-form.tsx

src/server/admin/
├── admin-actor.ts
├── audit.ts
├── audit-queries.ts
├── require-admin.ts
├── user-queries.ts
└── user-service.ts

src/server/characters/
├── avatar-assets.ts
├── character-content.ts
├── character-errors.ts
├── character-form-data.ts
├── character-queries.ts
├── character-service.ts
├── content-digest.ts
├── seed-characters.ts
└── seed-definitions.ts

src/server/db/
├── audit-schema.ts
├── character-schema.ts
├── client.ts
├── database.ts
├── migrate.ts
├── schema.ts
└── seed-characters.ts

tests/e2e/
├── administration.spec.ts
├── characters.spec.ts
└── support/admin.ts

drizzle/
├── 0003_official_characters.sql
└── meta/
```

Keep test files beside their source units under `src/**` following the existing
Vitest convention. Page tests stay beside `page.tsx`.

### Task 1: Define and Validate Character Content

**Files:**

- Create: `src/server/characters/character-content.ts`
- Create: `src/server/characters/character-content.test.ts`
- Create: `src/server/characters/content-digest.ts`
- Create: `src/server/characters/content-digest.test.ts`
- Create: `src/server/characters/character-errors.ts`

**Interfaces:**

- Consumes: Zod 4.6.5 and Node `crypto`.
- Produces:
  - `characterSlugSchema`
  - `characterContentSchema`
  - `CharacterContent`
  - `CharacterFieldGroup`
  - `characterContentDigest(content: CharacterContent): string`
  - `changedCharacterFieldGroups(previous: CharacterContent, next: CharacterContent): CharacterFieldGroup[]`
  - typed `CharacterDomainError` subclasses with stable `code` values.

- [ ] **Step 1: Write failing strict-schema tests**

Create table-driven tests that prove valid content parses and these inputs fail:

```ts
const validContent = {
  displayName: "Mira",
  avatarPath: "/characters/calm-listener.svg",
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
```

Assert:

```ts
expect(characterContentSchema.parse(validContent)).toEqual(validContent);
expect(characterSlugSchema.safeParse("Calm Listener").success).toBe(false);
expect(characterSlugSchema.safeParse("calm-listener").success).toBe(true);
```

Add explicit rejection cases for:

- `/../secret.svg`
- `https://example.com/avatar.svg`
- `/characters/avatar.svg?new=1`
- `/characters/avatar.exe`
- zero principles
- seven example conversations
- `temperature: 2.1`
- `topP: -0.1`
- `maxOutputTokens: 63`
- unknown nested keys

- [ ] **Step 2: Run the schema test and confirm red**

Run:

```bash
pnpm test -- src/server/characters/character-content.test.ts
```

Expected: FAIL because the schemas and exported types do not exist.

- [ ] **Step 3: Implement the exact bounded schemas**

Use a strict schema with these bounds:

```ts
const boundedLine = (maximum: number) => z.string().trim().min(1).max(maximum);

export const characterSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const avatarPathSchema = z.string().superRefine((value, context) => {
  if (
    !/^\/characters\/[A-Za-z0-9/_-]+\.(?:svg|png|webp|jpe?g)$/.test(value) ||
    value.includes("..") ||
    value.includes("\\") ||
    value.includes("?") ||
    value.includes("#")
  ) {
    context.addIssue({
      code: "custom",
      message: "must be a site-relative character image path",
    });
  }
});

export const characterContentSchema = z
  .object({
    displayName: boundedLine(80),
    avatarPath: avatarPathSchema,
    shortDescription: boundedLine(200),
    longDescription: boundedLine(2_000),
    personalityPrinciples: z.array(boundedLine(300)).min(1).max(8),
    speakingStyle: boundedLine(1_000),
    responseRhythm: boundedLine(500),
    relationshipBoundaries: z.array(boundedLine(300)).min(1).max(8),
    openingMessage: boundedLine(1_000),
    exampleConversations: z
      .array(
        z
          .object({
            user: boundedLine(500),
            assistant: boundedLine(1_000),
          })
          .strict(),
      )
      .min(1)
      .max(6),
    generationParameters: z
      .object({
        temperature: z.number().min(0).max(2),
        topP: z.number().min(0).max(1),
        maxOutputTokens: z.number().int().min(64).max(4_096),
      })
      .strict(),
    safetyAdditions: z.array(boundedLine(300)).max(8),
  })
  .strict();

export type CharacterContent = z.infer<typeof characterContentSchema>;
export type CharacterFieldGroup = keyof CharacterContent;
```

Normalize trimmed strings through Zod. Preserve array order because it is part
of the authored character behavior.

- [ ] **Step 4: Run the schema test and confirm green**

Run:

```bash
pnpm test -- src/server/characters/character-content.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing digest and changed-field tests**

Test that object key insertion order does not change the digest, array order
does change it, and changed-field output contains only top-level field names:

```ts
expect(characterContentDigest(validContent)).toMatch(/^[a-f0-9]{64}$/);
expect(
  changedCharacterFieldGroups(validContent, {
    ...validContent,
    openingMessage: "Take your time. What happened?",
  }),
).toEqual(["openingMessage"]);
```

- [ ] **Step 6: Implement canonical digest and domain errors**

Parse through `characterContentSchema`, serialize fields in schema order, and
hash with SHA-256:

```ts
export function characterContentDigest(content: CharacterContent): string {
  const parsed = characterContentSchema.parse(content);
  return createHash("sha256").update(JSON.stringify(parsed)).digest("hex");
}
```

Implement `changedCharacterFieldGroups` by comparing the canonical JSON value
of each top-level field. Add `CharacterDomainError` with these codes:

```ts
export type CharacterErrorCode =
  | "CHARACTER_NOT_FOUND"
  | "DRAFT_CONFLICT"
  | "UNCHANGED_DRAFT"
  | "INVALID_DEFAULT_VERSION"
  | "MISSING_AVATAR_ASSET"
  | "INVALID_CHARACTER_STATE";
```

- [ ] **Step 7: Run focused tests and type checking**

Run:

```bash
pnpm test -- src/server/characters/character-content.test.ts src/server/characters/content-digest.test.ts
pnpm typecheck
```

Expected: both commands exit 0.

- [ ] **Step 8: Commit Task 1**

```bash
git add src/server/characters
git commit -m "feat(characters): define character content contract" \
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 2: Add Character and Audit Database Invariants

**Files:**

- Create: `src/server/db/character-schema.ts`
- Create: `src/server/db/audit-schema.ts`
- Create: `src/server/db/character-schema.integration.test.ts`
- Create: `src/server/db/database.ts`
- Create: `src/server/db/database.test.ts`
- Modify: `src/server/db/schema.ts`
- Modify: `src/server/db/client.ts`
- Create: `drizzle/0003_official_characters.sql`
- Modify: `drizzle/meta/_journal.json`
- Create: `drizzle/meta/0003_snapshot.json`

**Interfaces:**

- Consumes: `CharacterContent` field shapes from Task 1 and existing auth `user`.
- Produces:
  - `character`
  - `characterDraft`
  - `characterVersion`
  - `adminAuditEvent`
  - `CharacterLifecycle`
  - `AdminAuditAction`
  - exported `Database = ReturnType<typeof createDatabase>`
  - `getDatabase(): Promise<Database>`.

- [ ] **Step 1: Write failing schema integration tests**

Use the existing `testDatabaseUrl()` guard and real PostgreSQL. Truncate product
tables before each test. Insert two characters and two versions, then prove:

```ts
await expect(
  database
    .update(characterVersion)
    .set({ displayName: "Mutated" })
    .where(eq(characterVersion.id, versionId)),
).rejects.toThrow(/immutable/i);

await expect(
  database.delete(characterVersion).where(eq(characterVersion.id, versionId)),
).rejects.toThrow(/immutable/i);

await expect(
  database
    .update(character)
    .set({ defaultVersionId: otherCharacterVersionId })
    .where(eq(character.id, characterId)),
).rejects.toThrow(/same character/i);

await expect(
  database
    .update(character)
    .set({ slug: "renamed-character" })
    .where(eq(character.id, characterId)),
).rejects.toThrow(/slug is immutable/i);
```

Also test one draft per character and unique `(character_id, version_number)`.

- [ ] **Step 2: Run the integration test and confirm red**

Run:

```bash
pnpm db:test:up
pnpm db:migrate
pnpm test -- src/server/db/character-schema.integration.test.ts
```

Expected: FAIL because product tables do not exist.

- [ ] **Step 3: Define typed Drizzle tables**

Use text UUID values generated by application code, timezone-aware timestamps,
JSONB fields typed from Task 1, and restrictive foreign keys.

Pass these exact PostgreSQL names to the corresponding `pgTable` declarations:
`characters`, `character_drafts`, `character_versions`, and
`admin_audit_events`.

`character` fields:

```ts
id: text("id").primaryKey(),
slug: text("slug").notNull().unique(),
lifecycle: characterLifecycleEnum("lifecycle").notNull().default("active"),
defaultVersionId: text("default_version_id"),
createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
archivedAt: timestamp("archived_at", { withTimezone: true }),
archivedBy: text("archived_by").references(() => user.id, { onDelete: "set null" }),
```

Because `defaultVersionId` points to a table declared later in the module, use
Drizzle's explicit lazy column type:

```ts
defaultVersionId: text("default_version_id").references(
  (): AnyPgColumn => characterVersion.id,
  { onDelete: "restrict" },
),
```

`characterDraft` uses `characterId` as its primary key, includes
`revision integer NOT NULL DEFAULT 1`, nullable `baseVersionId`, every content
field, `updatedBy`, `createdAt`, and `updatedAt`.

`characterVersion` includes text `id`, `characterId`, integer `versionNumber`,
every content field, 64-character `contentDigest`, nullable `publishedBy`, and
`publishedAt`. Add unique constraints on `(characterId, versionNumber)` and
`(characterId, id)`.

`adminAuditEvent` includes:

```ts
id: text("id").primaryKey(),
actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
actorLabel: text("actor_label").notNull(),
action: adminAuditActionEnum("action").notNull(),
targetType: text("target_type").notNull(),
targetId: text("target_id").notNull(),
metadata: jsonb("metadata").$type<Record<string, string | number | boolean | null>>().notNull(),
operationId: text("operation_id").notNull(),
createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
```

Define the complete `adminAuditActionEnum` values here and derive
`AdminAuditAction` from `adminAuditActionEnum.enumValues`.

Export the new tables from `schema.ts` and export the `Database` type from
`client.ts`.

- [ ] **Step 4: Add a runtime database singleton**

Implement `getDatabase()` in `database.ts` using `getRuntimeConfig()` and the
same retry-safe promise pattern as `getAuth()`. Its test injects mocked config
and `createDatabase`, calls `getDatabase()` twice concurrently, and proves only
one pool is created. Export a test-only reset helper guarded by
`NODE_ENV === "test"` so rejected initialization can be retried without leaking
a pool.

- [ ] **Step 5: Generate the named migration**

Run:

```bash
pnpm exec drizzle-kit generate --name official_characters
```

Expected: Drizzle creates `drizzle/0003_official_characters.sql` and updates
the metadata snapshot and journal.

- [ ] **Step 6: Add database triggers to the generated migration**

Append SQL functions and triggers that:

1. reject every `UPDATE` and `DELETE` on `character_versions` with
   `RAISE EXCEPTION 'published character versions are immutable'`;
2. reject an update that changes `character.slug` with
   `RAISE EXCEPTION 'character slug is immutable'`;
3. on insert or update of `characters.default_version_id`, verify a row exists
   in `character_versions` with both the selected version ID and
   `character_id = NEW.id`; and
4. reject a mismatch with
   `RAISE EXCEPTION 'default version must belong to the same character'`.

The default-version trigger must allow `NULL`.

- [ ] **Step 7: Apply the migration and run the integration test**

Run:

```bash
pnpm db:migrate
pnpm test -- src/server/db/character-schema.integration.test.ts src/server/db/database.test.ts
```

Expected: PASS.

- [ ] **Step 8: Verify schema generation is stable**

Run:

```bash
pnpm exec drizzle-kit generate --name schema_drift_check
git status --short drizzle src/server/db
```

Expected: Drizzle reports no schema changes and does not create a fourth
migration. If it creates one, reconcile the schema and `0003` before continuing.

- [ ] **Step 9: Commit Task 2**

```bash
git add src/server/db drizzle
git commit -m "feat(db): add immutable character storage" \
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 3: Add Administrator Authorization and Audit Writes

**Files:**

- Create: `src/server/admin/admin-actor.ts`
- Create: `src/server/admin/admin-actor.test.ts`
- Create: `src/server/admin/require-admin.ts`
- Create: `src/server/admin/require-admin.test.ts`
- Create: `src/server/admin/audit.ts`
- Create: `src/server/admin/audit.integration.test.ts`
- Create: `src/app/admin/layout.tsx`
- Create: `src/app/admin/page.tsx`
- Create: `src/app/admin/page.test.tsx`

**Interfaces:**

- Consumes: existing `getAuth()`, `Database`, `AdminAuditAction`, and `adminAuditEvent`.
- Produces:
  - `AdminActor { userId: string; label: string; operationId: string }`
  - `toAdminActor(session, operationId): AdminActor`
  - `requireAdmin(headers: Headers): Promise<AdminActor>`
  - `recordAdminAudit(executor: Pick<Database, "insert">, actor, event): Promise<void>`.

- [ ] **Step 1: Write failing authorization tests**

Test the pure actor conversion separately from Next navigation:

```ts
expect(() =>
  toAdminActor(
    { user: { id: "user-1", email: "u@example.com", role: "user" } },
    "op-1",
  ),
).toThrow("Administrator access required");

expect(
  toAdminActor(
    { user: { id: "admin-1", email: "a@example.com", role: "admin" } },
    "op-2",
  ),
).toEqual({
  userId: "admin-1",
  label: "a@example.com",
  operationId: "op-2",
});
```

Mock `getAuth().api.getSession`, `redirect`, and `notFound` to prove
`requireAdmin` redirects missing sessions and returns no data to a signed-in
non-administrator.

- [ ] **Step 2: Run tests and confirm red**

Run:

```bash
pnpm test -- src/server/admin/admin-actor.test.ts src/server/admin/require-admin.test.ts
```

Expected: FAIL because authorization helpers do not exist.

- [ ] **Step 3: Implement the administrator boundary**

Generate a fresh `operationId` with `randomUUID()` per request. Use
`redirect("/auth/sign-in")` for no session and `notFound()` for signed-in
non-administrators. The helper returns only actor identity, not the entire
session:

```ts
export interface AdminActor {
  userId: string;
  label: string;
  operationId: string;
}
```

Never accept actor IDs or roles from form data.

- [ ] **Step 4: Write failing audit integration tests**

Call `recordAdminAudit` inside a database transaction and assert the exact
stored actor, action, target, metadata, and operation ID. Add a rollback test:

```ts
await expect(
  database.transaction(async (transaction) => {
    await recordAdminAudit(transaction, actor, event);
    throw new Error("rollback");
  }),
).rejects.toThrow("rollback");

expect(await database.select().from(adminAuditEvent)).toHaveLength(0);
```

Add a metadata rejection test for nested objects and keys named
`prompt`, `password`, `token`, `reason`, `message`, or `memory`.

- [ ] **Step 5: Implement safe audit events**

Use the `AdminAuditAction` type derived from the Task 2 database enum. Verify
that the enum contains exactly:

```ts
const expectedActions = [
  "character.create",
  "character.draft.save",
  "character.version.publish",
  "character.default.change",
  "character.archive",
  "character.restore",
  "user.disable",
  "user.restore",
] satisfies AdminAuditAction[];
```

Validate metadata as a flat strict record of primitive values with at most 20
keys and reject sensitive key names case-insensitively. Insert a UUID event ID
using the supplied transaction executor.

- [ ] **Step 6: Add the protected administration shell**

`src/app/admin/layout.tsx` calls `requireAdmin(await headers())`, renders
navigation links to `/admin/characters`, `/admin/users`, and `/admin/audit`, and
then renders children. `src/app/admin/page.tsx` contains a concise administration
overview. Page tests mock `requireAdmin` and verify the navigation.

- [ ] **Step 7: Run focused tests and type checking**

Run:

```bash
pnpm test -- src/server/admin src/app/admin/page.test.tsx
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

```bash
git add src/server/admin src/app/admin
git commit -m "feat(admin): add authorization and audit boundary" \
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 4: Implement Transactional Character Workflows

**Files:**

- Create: `src/server/characters/avatar-assets.ts`
- Create: `src/server/characters/avatar-assets.test.ts`
- Create: `src/server/characters/character-service.ts`
- Create: `src/server/characters/character-service.integration.test.ts`

**Interfaces:**

- Consumes: Task 1 schemas/digests/errors, Task 2 tables, Task 3 `AdminActor` and audit writer.
- Produces:

```ts
export interface CharacterService {
  createCharacter(input: {
    slug: string;
    content: CharacterContent;
  }): Promise<{ characterId: string; draftRevision: number }>;
  saveDraft(input: {
    characterId: string;
    expectedRevision: number;
    content: CharacterContent;
  }): Promise<{ draftRevision: number }>;
  publishDraft(input: {
    characterId: string;
    expectedRevision: number;
  }): Promise<{
    versionId: string;
    versionNumber: number;
    draftRevision: number;
  }>;
  setDefaultVersion(input: {
    characterId: string;
    versionId: string;
  }): Promise<void>;
  setArchived(input: { characterId: string; archived: boolean }): Promise<void>;
}

export function createCharacterService(dependencies: {
  database: Database;
  actor: AdminActor;
  verifyAvatarAsset?: (avatarPath: string) => Promise<void>;
}): CharacterService;
```

- [ ] **Step 1: Write failing avatar verification tests**

Use a temporary directory to prove the verifier:

- accepts an existing file under `<root>/public/characters`;
- throws `MISSING_AVATAR_ASSET` for a missing file;
- rejects a resolved path outside `<root>/public`; and
- never includes an absolute local path in the public error message.

- [ ] **Step 2: Implement the asset verifier**

Resolve `avatarPath.slice(1)` against `<root>/public`, verify the resolved path
starts with the resolved public directory plus the platform separator, and call
`fs.access`. Convert file-system failures to `CharacterDomainError` with code
`MISSING_AVATAR_ASSET`.

- [ ] **Step 3: Write failing service integration tests**

Cover every workflow and transaction boundary:

1. create inserts stable character, revision-1 draft, and one audit event;
2. duplicate slug fails without partial rows;
3. stale `expectedRevision` throws `DRAFT_CONFLICT`;
4. two concurrent saves using the same revision yield one success and one
   conflict;
5. publish verifies the avatar, inserts immutable v1, updates
   `baseVersionId`, increments the draft revision, and does not set the default;
6. unchanged re-publication throws `UNCHANGED_DRAFT`;
7. two concurrent publications from the same draft revision yield one success
   and one `DRAFT_CONFLICT`, without duplicate version numbers;
8. setting another character's version throws `INVALID_DEFAULT_VERSION`;
9. archive and restore retain draft, versions, and default pointer; and
10. forced audit insertion failure rolls back the business mutation.

Assert each successful operation creates exactly one matching audit event.

- [ ] **Step 4: Run service tests and confirm red**

Run:

```bash
pnpm test -- src/server/characters/avatar-assets.test.ts src/server/characters/character-service.integration.test.ts
```

Expected: FAIL because the service is not implemented.

- [ ] **Step 5: Implement create and save transactions**

For `createCharacter`, parse slug/content before opening the transaction. Insert
the stable row, draft, and `character.create` event atomically.

For `saveDraft`, update with both character ID and expected revision:

```ts
const updated = await transaction
  .update(characterDraft)
  .set({
    ...content,
    revision: sql`${characterDraft.revision} + 1`,
    updatedBy: actor.userId,
    updatedAt: new Date(),
  })
  .where(
    and(
      eq(characterDraft.characterId, input.characterId),
      eq(characterDraft.revision, input.expectedRevision),
    ),
  )
  .returning({ revision: characterDraft.revision });
```

Zero returned rows means either not found or conflict; query existence once and
throw the matching typed error. Audit only the changed top-level field names.

- [ ] **Step 6: Implement publication under a row lock**

Inside one transaction:

1. lock the stable character and draft with this parameterized query:

   ```ts
   await transaction.execute(sql`
     SELECT c.id
     FROM characters c
     JOIN character_drafts d ON d.character_id = c.id
     WHERE c.id = ${input.characterId}
     FOR UPDATE OF c, d
   `);
   ```

2. verify the submitted revision;
3. parse content and verify the avatar;
4. compute the digest and reject it if equal to `baseVersionId`'s digest;
5. calculate `COALESCE(MAX(version_number), 0) + 1` while holding the character
   lock;
6. insert the immutable version;
7. update the draft's `baseVersionId` and increment its revision so stale
   editors cannot overwrite the post-publication state; and
8. insert `character.version.publish` audit metadata containing only the new
   version number.

Do not update `defaultVersionId`.

- [ ] **Step 7: Implement default and lifecycle transactions**

`setDefaultVersion` first selects a version by both `versionId` and
`characterId`, then updates the default pointer and audits the old/new version
numbers. Let the database trigger remain the final invariant.

`setArchived` updates lifecycle plus archived actor/time fields. Repeating the
current state is an `INVALID_CHARACTER_STATE` error, not a successful no-op.
Never clear the default pointer when archiving.

- [ ] **Step 8: Run focused tests, type checking, and lint**

Run:

```bash
pnpm test -- src/server/characters
pnpm typecheck
pnpm lint
```

Expected: all commands exit 0.

- [ ] **Step 9: Commit Task 4**

```bash
git add src/server/characters
git commit -m "feat(characters): add versioned character workflows" \
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 5: Seed Five Official Characters in Deployment

**Files:**

- Create: `public/characters/calm-listener.svg`
- Create: `public/characters/energetic-friend.svg`
- Create: `public/characters/rational-companion.svg`
- Create: `public/characters/creative-storyteller.svg`
- Create: `public/characters/action-coach.svg`
- Create: `src/server/characters/seed-definitions.ts`
- Create: `src/server/characters/seed-definitions.test.ts`
- Create: `src/server/characters/seed-characters.ts`
- Create: `src/server/characters/seed-characters.integration.test.ts`
- Create: `src/server/db/seed-characters.ts`
- Modify: `package.json`
- Modify: `docker-compose.yml`
- Modify: `README.md`

**Interfaces:**

- Consumes: Task 1 content schema, Task 2 tables, and Task 4 avatar verifier.
- Produces:
  - `OFFICIAL_CHARACTER_SEEDS`
  - `seedOfficialCharacters(database, options?: { rootDirectory?: string }): Promise<{ created: number; existing: number }>`
  - `pnpm db:seed:characters`
  - `pnpm db:deploy`.

- [ ] **Step 1: Write failing seed-definition tests**

Assert there are exactly five seeds, all IDs/slugs/avatar paths are unique, and
every content package passes `characterContentSchema`. Pin these stable IDs:

```ts
[
  "2af34f55-f24e-4b1d-b651-5ee52e06b31c",
  "5768ba76-7e7e-4820-a6b2-a4d4a0960663",
  "7ea46f9d-b734-40cb-ae57-24f9311d206d",
  "9a69137b-40b3-4814-bb7f-983e34f9c7f2",
  "c7eeeb5e-5f43-4747-88a1-f58472313306",
];
```

Test that principles, opening messages, example replies, and response rhythms
are not identical between any two seeds.

- [ ] **Step 2: Create accessible local SVG assets and seed packages**

Each SVG has a unique color and simple abstract mark, contains a `<title>`, and
does not embed scripts, external references, raster data, or text requiring a
licensed font.

Define complete packages for:

- `calm-listener`
- `energetic-friend`
- `rational-companion`
- `creative-storyteller`
- `action-coach`

Each seed must have behaviorally distinct principles, boundaries, pacing,
examples, and safety additions.

- [ ] **Step 3: Run seed-definition tests**

Run:

```bash
pnpm test -- src/server/characters/seed-definitions.test.ts
```

Expected: PASS.

- [ ] **Step 4: Write failing idempotency integration tests**

Prove the first run creates five stable rows, five v1 snapshots, five drafts,
and five default pointers. Then:

1. edit one seed draft;
2. change its default after publishing a test v2;
3. archive it;
4. run seeding again; and
5. assert the draft, default pointer, version count, and archived lifecycle are
   unchanged.

Also create a non-seed character using a reserved seed slug and assert seeding
fails explicitly without partially creating the remaining seeds.

- [ ] **Step 5: Implement transactional, non-overwriting seeding**

For each seed:

- query by stable ID and slug;
- if the stable ID exists with the expected slug, count it as existing and do
  not update any field;
- if the ID is absent but the slug exists, throw a collision error;
- otherwise validate content and asset, then in one transaction insert stable
  character, v1 snapshot, revision-1 draft with `baseVersionId = v1`, and
  `defaultVersionId = v1`.

Seed creation is a deployment bootstrap operation, not an administrator write,
so it does not create an `admin_audit_events` row.

- [ ] **Step 6: Add deploy commands**

Add:

```json
{
  "scripts": {
    "db:seed:characters": "node --env-file-if-exists=.env --import tsx src/server/db/seed-characters.ts",
    "db:deploy": "pnpm db:migrate && pnpm db:seed:characters"
  }
}
```

Change the Compose `migrate` service command to `["pnpm", "db:deploy"]`.
Change the image tag to `ai-companion-web:phase-2` and mount
`./public/characters:/app/public/characters:ro` for app, worker, and migrate
containers through the shared application definition.
Document standalone migration/seeding, idempotency, local avatar paths, and the
rule that published avatar files must not be overwritten.

- [ ] **Step 7: Run deployment-focused verification**

Run:

```bash
pnpm test -- src/server/characters/seed-definitions.test.ts src/server/characters/seed-characters.integration.test.ts
pnpm db:deploy
pnpm db:deploy
pnpm typecheck
```

Expected: tests pass, the first deploy creates missing seeds, the second reports
all five existing, and type checking exits 0.

- [ ] **Step 8: Commit Task 5**

```bash
git add public/characters src/server/characters src/server/db/seed-characters.ts package.json docker-compose.yml README.md
git commit -m "feat(characters): seed official catalog" \
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 6: Build the Public Character Catalog

**Files:**

- Create: `src/server/characters/character-queries.ts`
- Create: `src/server/characters/character-queries.integration.test.ts`
- Create: `src/components/characters/character-card.tsx`
- Create: `src/components/characters/character-card.test.tsx`
- Create: `src/components/characters/character-profile.tsx`
- Create: `src/components/characters/character-profile.test.tsx`
- Create: `src/app/characters/page.tsx`
- Create: `src/app/characters/page.test.tsx`
- Create: `src/app/characters/[slug]/page.tsx`
- Create: `src/app/characters/[slug]/page.test.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/app/page.test.tsx`
- Modify: `src/app/app/page.tsx`
- Modify: `src/app/app/page.test.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**

- Consumes: active characters and default versions from Tasks 2 and 5.
- Produces:

```ts
export interface PublicCharacterSummary {
  id: string;
  slug: string;
  displayName: string;
  avatarPath: string;
  shortDescription: string;
  openingMessage: string;
}

export interface PublicCharacterDetail extends PublicCharacterSummary {
  longDescription: string;
  personalityPrinciples: string[];
  speakingStyle: string;
  responseRhythm: string;
  relationshipBoundaries: string[];
}

export function listPublicCharacters(
  database: Database,
): Promise<PublicCharacterSummary[]>;
export function getPublicCharacterBySlug(
  database: Database,
  slug: string,
): Promise<PublicCharacterDetail | null>;
export function getPublishedCharacterVersion(
  database: Database,
  versionId: string,
): Promise<
  | (CharacterContent & {
      id: string;
      characterId: string;
      versionNumber: number;
    })
  | null
>;
export function resolveDefaultCharacterVersion(
  database: Database,
  characterId: string,
): Promise<
  | (CharacterContent & {
      id: string;
      characterId: string;
      versionNumber: number;
    })
  | null
>;
```

- [ ] **Step 1: Write failing public-query integration tests**

Insert active/default, active/no-default, archived/default, and active with
non-default history fixtures. Assert:

- catalog returns only active/default characters;
- card values come from the default version, not draft or latest version;
- detail returns `null` for archived, no-default, and unknown slugs;
- `getPublishedCharacterVersion` can still load an archived pinned version; and
- `resolveDefaultCharacterVersion` returns `null` for archived characters.

- [ ] **Step 2: Implement explicit public projections**

Join `character.defaultVersionId` to `characterVersion.id`, filter
`lifecycle = "active"`, select only public fields, and order by display name then
stable ID. Do not select prompt-only safety additions, examples, generation
parameters, draft fields, actor IDs, or audit data for public summaries.

- [ ] **Step 3: Write failing component and page tests**

Test accessible headings, image alt text, stable links, descriptions, and empty
catalog copy. For detail, mock a returned character and prove there is no chat
button or version selector. Mock `null` and verify `notFound()` is called.

- [ ] **Step 4: Implement reusable card/profile components and pages**

`CharacterCard` links to `/characters/${slug}`. `CharacterProfile` renders the
public detail fields. `/characters` and `/characters/[slug]` are force-dynamic
server pages that obtain the shared database through `getDatabase()` so
default-version changes are visible immediately.

Add a `Browse characters` link on the landing page and replace the Phase 1
placeholder on `/app` with a link to the catalog. Do not add a conversation
entry control.

- [ ] **Step 5: Add responsive catalog styles**

Use existing CSS/Tailwind conventions. Add a responsive grid, card focus state,
bounded avatar sizing, readable content width, and brand-primary links. Keep
the UI mobile-first and avoid a new component library.

- [ ] **Step 6: Run focused verification**

Run:

```bash
pnpm test -- src/server/characters/character-queries.integration.test.ts src/components/characters src/app/characters src/app/page.test.tsx src/app/app/page.test.tsx
pnpm typecheck
pnpm lint
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit Task 6**

```bash
git add src/server/characters/character-queries.ts src/server/characters/character-queries.integration.test.ts src/components/characters src/app/characters src/app/page.tsx src/app/page.test.tsx src/app/app/page.tsx src/app/app/page.test.tsx src/app/globals.css
git commit -m "feat(characters): add public official catalog" \
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 7: Build Character Administration Screens

**Files:**

- Create: `src/server/characters/character-form-data.ts`
- Create: `src/server/characters/character-form-data.test.ts`
- Extend: `src/server/characters/character-queries.ts`
- Extend: `src/server/characters/character-queries.integration.test.ts`
- Create: `src/components/admin/characters/character-editor.tsx`
- Create: `src/components/admin/characters/character-editor.test.tsx`
- Create: `src/components/admin/characters/character-preview.tsx`
- Create: `src/components/admin/characters/version-history.tsx`
- Create: `src/app/admin/characters/actions.ts`
- Create: `src/app/admin/characters/actions.test.ts`
- Create: `src/app/admin/characters/page.tsx`
- Create: `src/app/admin/characters/page.test.tsx`
- Create: `src/app/admin/characters/new/page.tsx`
- Create: `src/app/admin/characters/[id]/page.tsx`
- Create: `src/app/admin/characters/[id]/preview/page.tsx`

**Interfaces:**

- Consumes: Task 3 admin actor, Task 4 service, Task 6 shared public components.
- Produces:
  - `parseCharacterFormData(formData: FormData): CharacterFormParseResult`
  - `CharacterFormParseResult = { success: true; data: { slug?: string; content: CharacterContent; expectedRevision?: number } } | { success: false; fieldErrors: Record<string, string[]> }`
  - `AdminActionState { status: "idle" | "success" | "error"; message?: string; fieldErrors?: Record<string, string[]> }`
  - complete character administration UI and server actions.

- [ ] **Step 1: Write failing form-data tests**

Use these exact form conventions:

- scalar names match content keys;
- principles, boundaries, and safety additions are newline-delimited textareas;
- repeated `exampleUser` and `exampleAssistant` values pair by index;
- numeric generation fields are converted with `Number`;
- blank lines are removed; and
- a half-filled example pair is a field error, not silently discarded.

Assert invalid numeric input remains a validation error instead of becoming
`NaN` in the domain service.

- [ ] **Step 2: Implement strict form parsing**

Build a plain input object from `FormData`, pair examples, then call
`characterContentSchema.safeParse`. Return Zod's flattened field errors in a
stable shape used by the editor.

- [ ] **Step 3: Add administration query projections**

Implement:

- character list with lifecycle, draft revision, base version number, default
  version number, and latest version number;
- editor detail with draft content and version history;
- preview detail using the draft plus stable slug; and
- a selected published version lookup scoped to its character.

Administration queries require an actor at their call sites but contain no
public fallback.

- [ ] **Step 4: Write failing action tests**

Mock `requireAdmin`, `getDatabase`, and `createCharacterService`. Assert each
action:

- ignores any submitted actor/user ID;
- parses expected revision;
- maps Zod errors to `fieldErrors`;
- maps `DRAFT_CONFLICT` to a reload message;
- calls `revalidatePath` for both admin and public paths after relevant writes;
- redirects only after successful creation; and
- never reports success after a thrown service error.

- [ ] **Step 5: Implement server actions**

Add `"use server"` actions:

```ts
createCharacterAction;
saveCharacterDraftAction;
publishCharacterDraftAction;
setDefaultCharacterVersionAction;
archiveCharacterAction;
restoreCharacterAction;
```

Each action calls `requireAdmin(await headers())`, constructs a service with the
server database, validates form data, and returns `AdminActionState`. Public
revalidation is required after default, archive, and restore operations.

- [ ] **Step 6: Write failing page and component tests**

Cover:

- list state badges and links;
- editor labels for every character field;
- revision hidden input;
- visible field errors and operation status;
- preview reuse of `CharacterCard` and `CharacterProfile`;
- history showing immutable version number and publication time;
- explicit default-version form;
- separate archive/restore confirmation; and
- no delete control.

- [ ] **Step 7: Implement the character administration UI**

Use a client `CharacterEditor` with `useActionState`. Use one input per scalar,
newline textareas for bounded string arrays, and repeatable user/assistant
example pairs. The edit page provides separate Save, Preview, Publish, Set
Default, and Archive/Restore operations so no action has hidden side effects.

The preview page renders the persisted draft through shared public components
and shows the complete structured package in labeled sections. It does not call
a model.

- [ ] **Step 8: Run focused verification**

Run:

```bash
pnpm test -- src/server/characters/character-form-data.test.ts src/server/characters/character-queries.integration.test.ts src/components/admin/characters src/app/admin/characters
pnpm typecheck
pnpm lint
```

Expected: all commands exit 0.

- [ ] **Step 9: Commit Task 7**

```bash
git add src/server/characters src/components/admin/characters src/app/admin/characters
git commit -m "feat(admin): manage official character versions" \
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 8: Add Ordinary-User Controls and Audit Browsing

**Files:**

- Create: `src/server/admin/user-queries.ts`
- Create: `src/server/admin/user-queries.integration.test.ts`
- Create: `src/server/admin/user-service.ts`
- Create: `src/server/admin/user-service.integration.test.ts`
- Create: `src/server/admin/audit-queries.ts`
- Create: `src/server/admin/audit-queries.integration.test.ts`
- Create: `src/components/admin/users/user-status-form.tsx`
- Create: `src/components/admin/users/user-status-form.test.tsx`
- Create: `src/app/admin/users/actions.ts`
- Create: `src/app/admin/users/actions.test.ts`
- Create: `src/app/admin/users/page.tsx`
- Create: `src/app/admin/users/page.test.tsx`
- Create: `src/app/admin/audit/page.tsx`
- Create: `src/app/admin/audit/page.test.tsx`

**Interfaces:**

- Consumes: Task 2 auth/audit tables and Task 3 `AdminActor`.
- Produces:

```ts
export function listOrdinaryUsers(
  database: Database,
  input: {
    query?: string;
    page: number;
    pageSize: 25;
  },
): Promise<{ users: AdminUserSummary[]; total: number }>;

export function disableOrdinaryUser(
  database: Database,
  actor: AdminActor,
  input: {
    userId: string;
    reason: string;
  },
): Promise<void>;

export function restoreOrdinaryUser(
  database: Database,
  actor: AdminActor,
  input: {
    userId: string;
  },
): Promise<void>;

export function listAdminAuditEvents(
  database: Database,
  input: {
    page: number;
    pageSize: 50;
  },
): Promise<{ events: AdminAuditSummary[]; total: number }>;
```

- [ ] **Step 1: Write failing user-query tests**

Insert ordinary users and administrators. Assert the listing:

- includes only users whose role is exactly `user`;
- supports case-insensitive email/name search;
- returns only safe fields: ID, name, email, created time, and banned state;
- uses deterministic `createdAt DESC, id DESC` ordering; and
- enforces page size 25.

- [ ] **Step 2: Write failing user-service tests**

Create actor, target ordinary user, target administrator, and sessions. Assert:

```ts
await disableOrdinaryUser(database, actor, {
  userId: ordinaryUserId,
  reason: "Repeated abuse of instance rules",
});
```

results in:

- `banned = true`;
- stored `banReason` set for Better Auth enforcement;
- every target session deleted;
- one `user.disable` audit event whose metadata does not contain reason text.

Also prove:

- empty or over-500-character reasons fail validation;
- actor self-target fails;
- administrator target fails;
- already-disabled target fails as an invalid transition;
- forced audit failure rolls back ban fields and session deletion; and
- restore clears `banned`, `banReason`, and `banExpires`.

- [ ] **Step 3: Implement transactional user controls**

Select and lock the target user inside the transaction. Require
`target.role === "user"`, reject actor self-target, and require a trimmed reason
of 1–500 characters. Update Better Auth ban fields, delete all target sessions,
and write the audit event in the same transaction. Unknown or future roles are
not treated as ordinary users.

Audit metadata contains only:

```ts
{ previousState: "active", nextState: "disabled" }
```

or the inverse for restore.

- [ ] **Step 4: Implement safe user and audit queries**

Use parameterized Drizzle predicates for search. Audit summaries expose actor
label, action, target type/ID, safe metadata, operation ID, and timestamp. They
never join private authentication records beyond actor labels already copied
into the audit row.

- [ ] **Step 5: Write failing action, form, and page tests**

Assert:

- disable form requires visible reason and explicit confirmation;
- restore form has a distinct label;
- server actions obtain actor from `requireAdmin`;
- user IDs come from server-rendered target rows, but are still validated by
  the service;
- action errors render with `role="alert"`;
- audit page renders action/target/time without full prompt or reason content;
  and
- pagination links preserve the search query.

- [ ] **Step 6: Implement user and audit pages**

`/admin/users` is a server-rendered searchable, paginated table. The client
status form submits to server actions and disables buttons while pending.
`/admin/audit` is read-only and paginated. Neither page exposes role mutation,
impersonation, password reset, message data, or account deletion controls.

- [ ] **Step 7: Run focused verification**

Run:

```bash
pnpm test -- src/server/admin src/components/admin/users src/app/admin/users src/app/admin/audit
pnpm typecheck
pnpm lint
```

Expected: all commands exit 0.

- [ ] **Step 8: Commit Task 8**

```bash
git add src/server/admin src/components/admin/users src/app/admin/users src/app/admin/audit
git commit -m "feat(admin): add user controls and audit log" \
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 9: Add End-to-End Coverage and Release Documentation

**Files:**

- Create: `tests/e2e/support/admin.ts`
- Create: `tests/e2e/characters.spec.ts`
- Create: `tests/e2e/administration.spec.ts`
- Modify: `tests/e2e/protected-routes.spec.ts`
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-09-23-ai-companion-roadmap.md`

**Interfaces:**

- Consumes: all Phase 2 UI and services.
- Produces: deterministic browser acceptance coverage and operator documentation.

- [ ] **Step 1: Add an E2E administrator bootstrap helper**

Implement a helper that:

1. registers and verifies a unique test user through the existing public flow;
2. updates only that test user's role to `admin` through the guarded test
   database connection;
3. deletes its existing sessions so the next login reloads the role; and
4. signs in through the public UI.

The helper accepts the Playwright `page`, email, password, and database. It
never uses a production database because `testDatabaseUrl()` remains mandatory.

- [ ] **Step 2: Write the public catalog E2E test**

Verify a fresh `pnpm db:deploy` environment exposes all five seed cards to an
anonymous browser, each detail route renders its expected display name, and no
page contains a chat action or version selector.

Archive one test-created character only; do not mutate seeded characters in
this spec.

- [ ] **Step 3: Write the character administration E2E scenario**

Using a unique slug:

1. sign in as an administrator;
2. create and save a complete character draft;
3. preview its card, detail, and structured package;
4. publish v1 and prove anonymous catalog does not show it;
5. set v1 as default and prove it appears;
6. edit and publish v2 and prove public detail still shows v1;
7. set v2 as default and prove public detail changes;
8. archive it and prove it returns 404 publicly;
9. restore it and prove it returns; and
10. open `/admin/audit` and verify each action is present.

- [ ] **Step 4: Write the ordinary-user control E2E scenario**

Create and sign in an ordinary verified user in a separate browser context.
From the administrator context:

1. search for the user;
2. disable it with a reason;
3. prove the retained user context is redirected to sign in on `/account`;
4. prove a new sign-in is rejected;
5. restore the user;
6. prove sign-in succeeds; and
7. verify disable/restore audit rows without displaying the reason text.

Add `/admin`, `/admin/characters`, `/admin/users`, and `/admin/audit` to the
existing forged-cookie and unauthenticated protected-route test.

- [ ] **Step 5: Run targeted E2E tests**

Run:

```bash
pnpm db:deploy
pnpm test:e2e -- tests/e2e/characters.spec.ts tests/e2e/administration.spec.ts tests/e2e/protected-routes.spec.ts
```

Expected: all selected Playwright tests pass with one worker.

- [ ] **Step 6: Update release documentation**

Document:

- public catalog URLs;
- administrator URLs and CLI bootstrap;
- character draft/publish/default/archive semantics;
- deployer-managed avatar path and immutable filename rule;
- `pnpm db:deploy` and seed idempotency;
- ordinary-user disable/restore behavior;
- audit metadata privacy boundary; and
- Phase 2 exclusions.

Mark Phase 2 complete in the roadmap only after the full release gate passes.
Replace the roadmap's Phase 2 conversation-level acceptance sentence with a
version-contract acceptance: changing the default affects
`resolveDefaultCharacterVersion`, while the previous immutable version remains
loadable by ID. Move the actual existing-conversation pinning browser scenario
to Phase 3, where conversations exist.

- [ ] **Step 7: Run the full Phase 2 release gate**

Run:

```bash
pnpm db:test:up
pnpm db:deploy
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm test:e2e
pnpm exec drizzle-kit generate --name final_schema_drift_check
git status --short
```

Expected:

- all Vitest and Playwright tests pass;
- type checking, lint, and production build exit 0;
- Drizzle reports no schema changes and creates no new migration;
- only intentional tracked Phase 2 changes are present; and
- the unrelated existing `chrome-mac-arm64.zip` remains untracked and untouched.

- [ ] **Step 8: Commit Task 9**

```bash
git add tests/e2e README.md docs/superpowers/plans/2026-09-23-ai-companion-roadmap.md
git commit -m "test: verify Phase 2 administration flows" \
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

- [ ] **Step 9: Request independent whole-branch review**

Use the required execution workflow's fresh reviewer. The review must compare
the branch against:

- `docs/superpowers/specs/2026-10-08-official-characters-and-administration-design.md`
- this implementation plan;
- the Phase 2 roadmap acceptance condition; and
- the full release-gate output.

Fix Critical and Important findings with targeted tests, rerun the affected
checks, then rerun the full release gate before integration.
