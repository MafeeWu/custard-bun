# Official Characters and Administration Design

**Date:** 2026-10-08
**Status:** Awaiting written-spec approval
**Phase:** 2 of the AI companion roadmap

## 1. Purpose

Phase 2 adds the official-character catalog and the administration tools
required to manage characters and ordinary user access safely.

The product outcome is:

- anyone can browse a small catalog of distinct official AI characters;
- administrators can create, preview, publish, activate, archive, and restore
  official characters without editing source code;
- published character definitions are immutable so future conversations can
  remain attached to the version on which they started;
- administrators can disable and restore ordinary users without gaining access
  to private conversation content; and
- every explicit administrative write has a durable audit record.

This phase does not add model calls, conversations, or long-term memory. It
establishes the versioned character contract that Phase 3 will consume.

## 2. Product and Technical Constraints

- The application remains a TypeScript and Next.js modular monolith.
- The toolchain uses the TypeScript 7 compiler plus the official TypeScript 6
  API compatibility package so the production build runs native TypeScript 7
  preflight typechecking before `next build`, while lint tooling and Next's
  compiler-API consumers import the TypeScript 6 compatibility API.
- PostgreSQL remains the only required stateful production dependency.
- Characters are official content managed by administrators. Users cannot
  create or publish characters.
- The catalog and character detail pages are publicly readable. Starting a
  conversation will require authentication when chat is added.
- Each character has at most one mutable draft.
- Publishing produces an immutable snapshot but does not automatically make it
  the default version for new conversations.
- Archived characters disappear from the public catalog and cannot be selected
  for new conversations. Archiving does not invalidate pinned versions, so
  existing conversations added in Phase 3 can continue using them.
- Avatar files are supplied by the deployer under a public application path.
  Phase 2 does not add file upload or object storage.
- The deployment CLI remains the only way to create or change administrator
  accounts. The administration UI manages ordinary users only.

## 3. Scope

### 3.1 Included

- Stable character identities and immutable character versions
- One mutable draft per character
- Five distinct seeded official characters
- Public character catalog and detail pages
- Administrator character creation, editing, preview, publishing, default
  version selection, archiving, and restoration
- Published-version history in the administration UI
- Ordinary-user listing, disabling, and restoration
- Durable administrative audit events
- Domain read contracts for resolving the default version for a new
  conversation and reading a published version by ID

### 3.2 Excluded

- Model calls or administrator test chats
- Conversation or message storage
- Long-term memory
- User-created or publicly shared characters
- Character marketplace, ratings, comments, or recommendation feeds
- Avatar upload, object storage, or remote image URLs
- Public browsing of old character versions
- Administrator role management in the web UI
- Temporary bans with automatic expiration
- Voice, image generation, RAG, plugins, billing, or relationship levels

## 4. User Experience

### 4.1 Public catalog

`/characters` lists characters that are active and have a default published
version. Cards render only the default version's public presentation fields.
Drafts, non-default published versions, characters without a default version,
and archived characters are never returned by the public query.

`/characters/[slug]` renders the selected character's current default version.
An unknown slug, an archived character, or a character without a default
version is treated as not found.

Anonymous visitors may browse both pages. Phase 2 does not render a conversation
entry control because chat is not available. Phase 3 adds the
authentication-gated entry control using the character-domain contracts defined
in this phase.

### 4.2 Administration

The `/admin` area includes:

- a character list showing lifecycle state, draft state, default version, and
  latest published version;
- character creation and draft editing;
- a preview of the real catalog card, character detail view, and structured
  character package;
- published-version history and explicit default-version selection;
- character archive and restore actions;
- ordinary-user search or pagination with disable and restore actions; and
- an audit-event view sufficient to trace the operations delivered in this
  phase.

Public card and detail components are shared with the administrator preview so
the preview cannot drift into a separate visual interpretation.

## 5. Character Content

Each draft and published version contains:

- display name;
- deployer-provided avatar path;
- short and long descriptions;
- personality principles;
- speaking style;
- response rhythm;
- relationship boundaries;
- opening message;
- a small structured set of example conversations;
- recommended generation parameters; and
- character-specific safety additions.

The form groups these fields into presentation, personality, conversational
behavior, boundaries, examples, generation guidance, and safety sections.

Structured fields use explicit schemas and bounded arrays rather than arbitrary
JSON. Recommended generation parameters accept only the provider-independent
fields approved for the future model gateway, with conservative numeric bounds.
All strings, arrays, examples, and nested objects have explicit length or count
limits.

Avatar paths use the application's existing public-path convention. They must
be absolute site-relative paths, reject traversal and URL forms, and use an
approved image extension. Publication also verifies that the referenced asset
is available. Deployers must use a new, non-overwritten filename when changing
a published avatar; a new character version records the new path.

## 6. Architecture

The character subsystem is divided into focused server-only units:

- **Schemas:** input normalization, field bounds, structured content, avatar
  paths, and generation parameters.
- **Public queries:** active catalog and detail reads against default versions
  only.
- **Administration queries:** drafts, version history, users, and audit events.
- **Character services:** transactional creation, draft saves, publishing,
  default selection, archiving, and restoration.
- **User administration service:** ordinary-user disable and restore workflows.
- **Repositories:** typed Drizzle queries and row-locking primitives.
- **Authorization:** shared administrator guards used by pages and every write
  action.

React Server Components call read services directly. Server Actions provide the
administration form boundary and call transactional domain services. Neither
pages nor actions perform ad hoc database writes.

Phase 3 will consume two character-domain functions:

- resolve the active default version for a new conversation; and
- load a specific immutable published version by version ID.

Phase 2 does not create placeholder conversation tables or APIs.

## 7. Data Model

### 7.1 `characters`

The stable character identity contains:

- `id`
- unique, stable `slug`
- lifecycle state: `active` or `archived`
- nullable `default_version_id`
- `created_by`
- `created_at`
- `updated_at`
- nullable `archived_at`
- nullable `archived_by`

The slug becomes immutable after creation so public links and future
conversation references remain stable. A character is never physically deleted
through the product.

`default_version_id`, when present, must refer to a published version belonging
to the same character. This invariant is enforced in the database, not only in
application code.

### 7.2 `character_drafts`

There is at most one row per character. It contains all character content plus:

- `character_id`
- optimistic-lock `revision`
- nullable `base_version_id`
- `updated_by`
- `created_at`
- `updated_at`

`base_version_id` identifies the published version from which the current draft
was initialized or last published. The draft remains after publication and
becomes the editing base for the next version.

### 7.3 `character_versions`

Published versions are append-only snapshots containing:

- `id`
- `character_id`
- per-character monotonic `version_number`
- all validated character content
- deterministic content digest
- `published_by`
- `published_at`

`published_by` is a nullable, durable publisher ID, not a live foreign key to
the authentication user. Account deletion retains this original value without
updating the published row. This preserves both immutable attribution and the
existing verified account-deletion workflow.

The pair `(character_id, version_number)` is unique. Published rows cannot be
updated or deleted through application code, and a database trigger rejects
`UPDATE` and `DELETE` operations. Foreign keys use restrictive behavior so a
stable character cannot be deleted around the immutability rule.

The content digest detects attempts to publish an unchanged draft. It is
calculated from a canonical serialization of versioned fields only.

### 7.4 `admin_audit_events`

Audit rows contain:

- `id`
- nullable actor user ID plus a durable actor label;
- action type;
- target type and target ID;
- small validated metadata;
- request or operation ID; and
- `created_at`.

Recorded actions include character creation, draft save, publication, default
version change, archive, restore, user disable, and user restore.

Metadata may contain version numbers, lifecycle states, and names of changed
field groups. It must not duplicate full character prompts, passwords, tokens,
private conversation content, or the full text of a user-disable reason.

The audit insert and the corresponding state change occur in one database
transaction.

## 8. Workflows and Invariants

### 8.1 Create a character

An administrator supplies a unique slug and the initial content. The service
creates the stable identity, its draft, and the audit event in one transaction.
The new character is not public because it has no default version.

### 8.2 Save a draft

The client submits the expected draft revision. The service validates and
normalizes the full draft, updates only when the revision still matches, and
increments the revision. A stale revision produces an explicit conflict and
does not overwrite another administrator's work.

The audit event records the changed field groups, not full before-and-after
content.

The editor retains raw input and its base revision as one local snapshot.
Refreshed server props do not rebase unsaved content; only a confirmed save or
publication advances the editor revision. Failed submissions retain every
field. Example conversation controls add and remove complete paired inputs,
with a minimum of one pair and a maximum of six.

### 8.3 Publish a version

The service locks the character and draft, validates the complete package,
verifies the avatar asset, calculates the content digest, and rejects an
unchanged draft. It allocates the next per-character version number, inserts the
immutable snapshot, updates the draft's base version, and writes the audit event
in one transaction.

Publishing does not change the character's default version.

### 8.4 Select a default version

An administrator explicitly selects any published version belonging to the
character. The service validates ownership, updates the default pointer, and
writes the audit event atomically.

New public reads immediately use the selected version. Previously published
versions remain immutable and available to future pinned conversations.

### 8.5 Archive and restore

Archiving changes only the stable character lifecycle. It removes the character
from public queries and prevents future conversation selection without changing
its draft, default pointer, or published versions.

Restoring makes the character public again when it still has a default version.
Both actions are audited.

### 8.6 Disable and restore an ordinary user

Only users whose role is not administrative may be targeted. The acting
administrator cannot target itself.

Disabling requires a reason, sets the existing Better Auth ban fields, revokes
the target user's active sessions, and writes an audit event in one database
transaction. Restoring clears the disabled state and writes its audit event in
one database transaction. Phase 2 does not expose automatic expiration.

A PostgreSQL session-insertion trigger share-locks the target user and rejects
disabled users. The disable transaction holds the conflicting user lock until
session deletion and audit commit, so concurrent sign-in cannot leave a live
session behind. Authoritative session reads and protected-route guards also
reject a retained session whose user is banned, without cookie-cache fallback.

## 9. Authorization and Privacy

The existing deployment command remains responsible for creating the first
administrator. Phase 2 does not add administrator invitation or role-editing
screens.

A shared server-side administrator guard protects every administration page,
query, and action:

- unauthenticated browser requests are directed to sign in;
- authenticated non-administrators receive no administration data; and
- write services independently verify administrator status even when called
  outside a page.

Each administrative write transaction share-locks and re-reads its actor before
mutating state, requiring the role to be exactly `admin` and `banned` not to be
true. Concurrent demotion, disabling, or deletion cannot invalidate this check
before the write and audit commit.

The administration UI does not expose password data, authentication tokens,
private messages, memories, or model prompts assembled from user data. Character
content is administrative product content, but audit metadata still avoids
copying the full package.

## 10. Seed Characters

The initial catalog contains five behaviorally distinct characters:

1. a calm listener;
2. an energetic friend;
3. a rational companion;
4. a creative storyteller; and
5. a gentle action coach.

Their differences must be expressed through personality principles,
interaction patterns, boundaries, pacing, examples, and safety additions, not
through superficial wording alone.

An idempotent seed command runs after schema migration in the standard
deployment migration flow. Each seed uses a stable internal ID and slug. On its
first run, the command creates the character, a validated v1 snapshot, and its
default pointer. Later runs may add a missing seed but never overwrite an
existing seed's draft, versions, default pointer, or archived state.

An incompatible stable-ID or slug collision fails explicitly. Seed content uses
the same schemas as administrator publication.

## 11. Error Handling and Observability

Expected failures are represented as typed categories:

- unauthenticated;
- forbidden;
- validation failure;
- resource not found;
- draft revision conflict;
- invalid lifecycle transition;
- unchanged publication;
- missing avatar asset; and
- database failure.

Form actions return field-specific validation errors and safe operation-level
messages. Conflicts instruct the administrator to reload before saving.
Database failures roll back both business state and audit state. No failed
operation returns a success-shaped fallback.

Operational logs include an operation ID, error category, actor ID when safe,
and target ID. They exclude full character packages, disable-reason text,
authentication secrets, and private user content.

## 12. Testing Strategy

Development follows test-driven development.

### 12.1 Unit tests

- field normalization, bounds, and strict structured schemas;
- avatar-path validation;
- canonical serialization and content digests;
- unchanged-publication detection;
- permission and target eligibility checks;
- lifecycle transition rules; and
- safe audit metadata construction.

### 12.2 Database integration tests

- one draft per character;
- unique and monotonic per-character version numbers;
- concurrent publication behavior;
- database rejection of published-version updates and deletes;
- same-character default-version enforcement;
- optimistic draft conflicts;
- transaction rollback including audit rows;
- active/default public filtering;
- archive and restore behavior; and
- user disabling, session revocation, and restoration.

Destructive database tests continue to use the existing loopback and `_test`
database safety guards.

### 12.3 Page and component tests

- anonymous catalog and detail rendering;
- no draft or historical-version leakage;
- not-found behavior for archived or unready characters;
- administrator route protection;
- editor validation and conflict states;
- shared public and preview components; and
- safe user administration fields.

### 12.4 End-to-end tests

The primary administrator scenario is:

1. sign in as the CLI-created administrator;
2. create a character and save its draft;
3. preview its card, detail page, and structured package;
4. publish v1 and verify it is not public without a default;
5. set v1 as default and verify it becomes public;
6. edit and publish v2 and verify the public page remains on v1;
7. set v2 as default and verify the public page changes;
8. archive the character and verify it disappears;
9. restore it and verify it returns; and
10. verify the corresponding audit events.

A second scenario creates or uses an ordinary user, disables it, proves its
active session can no longer access protected pages, restores it, proves it can
authenticate again, and verifies the audit events.

## 13. Acceptance Criteria

- A fresh standard deployment contains five validated official characters
  without manual database work.
- Anonymous visitors can browse active characters and their current default
  details.
- Drafts and non-default versions never appear in public reads.
- An administrator can create, edit, preview, publish, activate, archive, and
  restore a character through the web UI.
- Publishing never mutates an existing published version and never
  automatically changes the default version.
- Database constraints prevent cross-character default-version references and
  mutation or deletion of published versions.
- A later default-version change leaves earlier versions available for future
  conversation pinning.
- An administrator can disable and restore ordinary users but cannot manage
  administrator roles or disable an administrator.
- Every explicit administrative write delivered in this phase creates an audit
  event in the same transaction.
- No administration view or log exposes authentication secrets or private
  conversation content.
- Unit, integration, page, and end-to-end tests cover the critical versioning,
  authorization, user-control, and audit invariants.
