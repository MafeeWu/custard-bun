# Custard Bun

Custard Bun is a self-hosted foundation for private AI companion
conversations. Phase 2 provides runtime branding, account registration,
email verification, password recovery, account deletion, deployable
application and worker processes, the official character catalog, and
administrator character and ordinary-user controls.

Chat and long-term memory arrive in later phases. Model credentials will remain
server-only when model integrations are added.

The anonymous official character catalog is available at `/characters`, with
public detail pages at `/characters/<slug>`. Both pages show only active
characters that have a default published version, and they render fields from
that default version only.

## Prerequisites

Use either:

- Docker with Docker Compose; or
- Node.js 24.x, pnpm 12.5.1, and PostgreSQL 16.

## Configure

Copy the environment template and replace every placeholder:

```bash
cp .env.example .env
```

Edit `app.config.yml` for the public site name, description, logo, favicon,
primary color, registration policy, and public links. The Compose deployment
mounts this file at runtime, so branding changes require a service restart but
not an image rebuild.

Keep `.env` private. It contains the database, authentication, and SMTP
credentials. Mailpit is used only by the automated test stack and is not a
production dependency.

`POSTGRES_PASSWORD` may contain URI delimiters such as `/`, `?`, `#`, `@`,
literal `%2F`, `$`, and spaces. Use **single quotes** in `.env`, for example
`POSTGRES_PASSWORD='replace/ ? # @ %2F $literal space'` (not a real password).
Compose interpolates `$NAME` and `${NAME}` in unquoted and double-quoted values;
single-quoted dotenv values preserve literal `$` without expansion. In Compose
YAML itself, use `$$` for a literal `$`. Do not pre-encode the raw password or
copy the illustrative password. For literal single quotes in dotenv values,
escape them with `\'`; avoid sourcing this file as shell code.
The production entrypoint constructs
and percent-encodes `DATABASE_URL` at runtime without storing a second copy of
the password.

## Deploy with Docker Compose

Build, migrate, and start PostgreSQL, the email worker, and the web app:

```bash
docker compose up --build
```

The same production image is used for the migration job, worker, and app.
It retains the pinned lockfile for runtime CLI commands and omits rebuild-only
Next caches; startup must not resolve or install a new dependency graph.

`pnpm start` runs the supported production HTTP boundary in the same process as
Next. It validates the entire runtime configuration **before listening**, then
replaces all forwarding identity headers with the actual TCP socket peer. Better
Auth reads only this server-owned identity; callers cannot choose rate-limit
keys via `X-Forwarded-For`, `Forwarded`, or the internal header. Do not bypass
this boundary with `next start`. An optional upstream proxy/NAT is treated as
one peer (shared limits); forwarded client identities are intentionally not
trusted. `pnpm dev` is development-only and must not be publicly exposed.

Create the first administrator after the services are healthy:

```bash
docker compose exec app /bin/sh /app/scripts/docker-entrypoint.sh \
  pnpm exec auth create-admin \
  --config src/server/auth/auth-cli.ts \
  --email admin@example.com \
  --name "Admin" \
  --role admin
```

Run migrations independently when needed:

```bash
docker compose run --rm migrate
```

The migration job runs `pnpm db:deploy`, which applies database migrations and
then idempotently seeds the five official character packages. For local or
standalone operations, run the same steps directly:

```bash
pnpm db:migrate
pnpm db:seed:characters
# or both:
pnpm db:deploy
```

Character seeding is safe to rerun. Existing official character IDs with their
expected slugs are counted as existing and are not overwritten: drafts,
published versions, default version pointers, lifecycle state, and admin state
remain unchanged. A reserved slug or stable ID collision fails explicitly and
rolls back the seed operation instead of partially creating the catalog. The
bootstrap seed does not create administrator audit events.

Official avatars live under `public/characters` and are referenced as local
paths such as `/characters/calm-listener.svg`. Compose mounts this directory
read-only into the app, worker, and migration containers. Published avatar
files are immutable operational assets: add a new file and publish a new
character version instead of overwriting a file that an existing version
references.

## Characters and administration

Anonymous visitors can browse `/characters` and `/characters/<slug>`.
Only active characters with an explicitly selected default published version
are public. Unknown, archived, and not-yet-defaulted character URLs return 404.
Neither page offers chat or historical-version selection in Phase 2.

Sign in with the CLI-created administrator account, then use:

- `/admin`: administration home;
- `/admin/characters`: lifecycle, draft, default, and latest-version overview;
- `/admin/characters/new`: create a character with a unique, permanent slug;
- `/admin/characters/<id>`: edit, publish, select a default, archive, or restore;
- `/admin/characters/<id>/preview`: preview the **saved** draft's real catalog
  card, detail view, and structured character package;
- `/admin/users`: search ordinary users and disable or restore access; and
- `/admin/audit`: read-only, paginated administrative history.

Unauthenticated requests redirect to sign-in; ordinary accounts receive no
administration data. The deployment CLI above is the only administrator
bootstrap/role-management path. There is no web role editor or invitation flow.
For standalone deployments, run the same CLI against the configured instance:

```bash
pnpm exec auth create-admin --config src/server/auth/auth-cli.ts \
  --email admin@example.com --name "Admin" --role admin
```

### Character version lifecycle

Each stable character has at most one mutable draft. Save the complete package
before previewing or publishing. Saving uses a draft revision: if another
administrator saves first, reload and reconcile the changes rather than
overwriting them.

Publishing validates the content and the avatar's availability, rejects an
unchanged package, and appends an immutable numbered snapshot. It retains the
draft as the base for further editing. **Publishing never selects the default.**
Use the version-history controls to explicitly choose a published version.
Public reads then use that version; older snapshots remain loadable by ID.
The Phase 3 integration contracts are `resolveDefaultCharacterVersion` for a
new conversation and `getPublishedCharacterVersion` for an existing version.

Archive hides a character from the public catalog and makes its public detail
URL return 404. It does not delete the draft, versions, or default pointer.
Restore makes it public again if a default is still selected. There is no
character deletion operation.

Avatar paths must be site-relative under `/characters/`, with `.svg`, `.png`,
`.webp`, `.jpg`, or `.jpeg` extensions. Remote URLs, traversal, query strings,
and fragments are rejected. Deploy the file under `public/characters` before
publication. Never overwrite an avatar referenced by a published version:
deploy a new filename and publish a version referencing that path.

### User controls and audit privacy

Disabling an ordinary account requires a reason and confirmation. It immediately
revokes **all** active sessions and rejects subsequent sign-ins. Restoring
clears the disabled state; the user must sign in again. There is no timed ban
or automatic expiration. Administrators cannot disable themselves or other
administrators through these controls.

Character creation, draft saves, publication, default changes, archive/restore,
and user disable/restore write audit events atomically with their state changes.
Events retain the actor label, target, operation ID, timestamp, and small
metadata such as version numbers, lifecycle state, and changed field names.
Audit pages and operational logs must not copy full character packages,
disable-reason text, passwords, tokens, or private user content. A disable
reason is stored in the authentication ban record, not displayed in the audit
view; audit is not a private-message inspection interface.

Phase 2 deliberately excludes model calls/test chats, conversations/messages,
actual conversation-version pinning, memory, user-created/shared characters,
marketplace/social features, avatar uploads/object storage, public history
browsing, web administrator-role management, automatic ban expiry, voice,
image generation, RAG, plugins, billing, and relationship levels.

## Service health

Health endpoints:

- Liveness: `http://127.0.0.1:3000/api/health/live`
- Readiness: `http://127.0.0.1:3000/api/health/ready`

Readiness includes a fresh worker heartbeat and persisted SMTP delivery health.
A failed delivery makes `worker: "error"` even while the worker is alive. Jobs
remain retryable; a later successful SMTP delivery restores health. Heartbeats,
restarts, and synthetic no-op jobs do not clear a recorded delivery failure.
The public response never includes infrastructure or email details.

Auth callbacks await durable queue acceptance, not SMTP. Failed signup acceptance
rolls back user/credential creation. Duplicate signup and unknown-account recovery
accept synthetic no-op jobs through the same queue so dependency failure has the
same public status/body as the corresponding real request. No-op jobs have no
email address or token and never send mail. Failed acceptance returns a sanitized
error so callers can retry; deletion does not claim a confirmation was sent.
SMTP delivery failures after acceptance are handled by the worker's bounded
retries/dead-letter queue. Password recovery revokes all existing sessions.

## Run locally

For local Node development, export a percent-encoded `DATABASE_URL` for the
PostgreSQL instance you intend to use and set the SMTP values to a reachable
mail server. The test stack exposes PostgreSQL on port `55432` and Mailpit SMTP
on port `1025`. Then apply migrations and run the app and worker in separate
terminals:

```bash
pnpm db:test:up
pnpm db:deploy
pnpm dev
pnpm worker
```

## Tests

DB-backed tests require a loopback PostgreSQL target whose name ends in `_test`,
without URL query overrides. Set `TEST_DATABASE_URL` to override the default
`postgresql://companion:companion@127.0.0.1:55432/companion_test`.
An unsafe ordinary `DATABASE_URL` is rejected before opening a pool or running
destructive SQL. Vitest files run serially, and queue suites remove their jobs
on exit; do not run multiple test commands against the same test database.
Playwright supplies the same fixed test environment to its app, worker, and
owned branding server, independently of your shell's SMTP/auth variables.

```bash
pnpm db:test:up
DATABASE_URL=postgresql://companion:companion@127.0.0.1:55432/companion_test pnpm db:migrate
pnpm test
pnpm db:deploy
pnpm test:e2e
pnpm db:test:down
```

Before running `db:deploy` in the test sequence, ensure `.env`'s `DATABASE_URL`
targets the same guarded local test database as `TEST_DATABASE_URL`. Integration
tests share that database and may truncate the seeded catalog: **rerun
`pnpm db:deploy` immediately before every Playwright run**, even if migrations
and seeds ran earlier. Do not point this sequence at a production database.

Phase 2 E2E tests use one worker and unique public registrations verified through
Mailpit. A test-only, loopback/`_test`-guarded helper promotes only the newly
verified account, revokes its sessions, and signs in through the public UI.
It is not a production bootstrap bypass. Tests never edit seed characters.
Cleanup archives only owned test-created characters and removes fixture
sessions/credentials while retiring the fixture accounts. Immutable versions,
publisher identities, and audit history are intentionally retained, not deleted
by disabling integrity triggers. Do not run concurrent suites on this database.

Full release gate (with the test database configured as above):

```bash
pnpm db:test:up
pnpm db:deploy
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm db:deploy
pnpm test:e2e
pnpm exec drizzle-kit generate --name final_schema_drift_check
git status --short
```

Every command must pass; Drizzle must report no schema changes and create no
migration. The currently pinned TypeScript 7.0.2 / typescript-eslint 8.70.1
combination blocks `pnpm lint` at startup (`typescript-eslint does not support
TS 7.0`). Phase 2 release acceptance remains blocked until that incompatibility
is resolved through an approved toolchain change. Do not downgrade TypeScript,
bypass its parser, or disable lint rules to claim a green gate.

Next 16 automatically maintains both production and development route-type
includes in `tsconfig.json` during `next typegen`/build; these generated-directory
globs are not checked-in type artifacts and need not exist on a clean checkout.

## Backups and operations

Back up both the PostgreSQL database and `app.config.yml`. The database holds
accounts and durable jobs; the YAML file holds the instance identity and
public operating policy. Store `.env` securely in your secret-management
system and test restoration procedures before relying on backups.

Stop the production stack with:

```bash
docker compose down
```
