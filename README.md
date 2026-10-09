# Custard Bun

Custard Bun is a self-hosted application for private, streamed AI companion
conversations. Phase 3 includes runtime branding, account lifecycle, official
character administration, version-pinned conversations, an OpenAI-compatible
model gateway, explicit interruption/retry states, transactional quotas, and
aggregate-only usage administration. Long-term memory remains a later phase.

The anonymous official character catalog is available at `/characters`, with
public detail pages at `/characters/<slug>`. Both pages show only active
characters that have a default published version, and they render fields from
that default version only.

## Prerequisites

Use either:

- Docker with Docker Compose; or
- Node.js 24.x, pnpm 12.5.1, and PostgreSQL 16.

The TypeScript toolchain intentionally uses the TypeScript 7 compiler plus the
official TypeScript 6 API compatibility package. Keep `pnpm typecheck` on
`tsc --noEmit`: the workspace `tsc` binary resolves through `@typescript/native`
to TypeScript 7.0.2, while linting, Next's compiler-API consumers, and other
tooling import `typescript` through `@typescript/typescript6` and see the
TypeScript 6.0.3 API. The production `pnpm build` entry point runs that native
TypeScript 7 preflight via `pnpm typecheck` before `next build`.

## Configure

Copy the environment template and replace every placeholder:

```bash
cp .env.example .env
```

Edit `app.config.yml` for the public site name, description, logo, favicon,
primary color, registration policy, and public links. The Compose deployment
mounts this file at runtime, so branding changes require a service restart but
not an image rebuild.

Keep `.env` private. It contains the database, authentication, SMTP, and model
provider credentials. Configure:

- `MODEL_API_BASE_URL`: the provider's OpenAI-compatible API root, ending
  before `chat/completions` (for example `https://provider.example/v1`);
- `MODEL_API_KEY`: the server-side bearer credential; and
- `MODEL_ID`: the provider model identifier used for chat completions.

Trusted loopback or private-network HTTP model servers are supported for
self-hosting. Only configure a server you control and trust: prompts include
character instructions and the user's current/recent conversation content.
The deployer is responsible for the provider's retention, training, residency,
access-control, and privacy terms. Model values are runtime-only Compose
environment variables; they are not public build arguments or browser
configuration.

Mailpit is used only by the automated test stack and is not a production
dependency.

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
The image build continues to invoke `pnpm build`, so Docker and Compose run the
native TypeScript 7 `pnpm typecheck` preflight before `next build` while Next's
own build-time compiler-API consumers still resolve the official TypeScript 6
compatibility package.

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
then idempotently seeds the five official character packages and initial chat
settings. For local or standalone operations, run the same steps directly:

```bash
pnpm db:migrate
pnpm db:seed:characters
pnpm db:seed:chat-settings
# or all three:
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

## Chat behavior and safety bounds

Signed-in users can start one active conversation per character. The opening
message is persisted locally and does not call the provider. Each conversation
pins the immutable character version selected at creation:

- publishing or selecting a new default does not change an existing chat;
- **Start over** archives the current chat and creates a new chat using the
  current default version;
- archived history is read-only and can be deleted independently; and
- deleting an active chat removes it permanently and returns to the app home.

Archiving a character removes it from new/public selection. Existing active
conversations remain usable, but they cannot be restarted until the character
is restored with a selected default.

Responses stream into the timeline. **Stop** retains received partial text and
marks the attempt interrupted. A browser disconnect, provider disconnect, or
incomplete stream remains visibly interrupted rather than being presented as
complete. Retry replaces the incomplete generated attempt without duplicating
the source user message. Only one generation may run for a user across all
their conversations at a time.

Partial output is checkpointed after approximately 500 ms even if the provider
stalls, or after 1 KiB of new text. Opening an affected conversation recovers an
expired generation as interrupted. Crash recovery and account deletion charge
durable partial output once using the tokenizer's 20% safety margin when provider
usage is unavailable, and release unused token reservations.

If a submission loses its response before admission is confirmed, resending the
unchanged draft reuses its request key. A terminal replay reloads the persisted
transcript rather than creating another turn; editing the draft starts a new
submission.

`app.config.yml` defines deployer safety ceilings and first-deploy defaults:

- first-token and total request timeouts;
- prompt-token budget, maximum input characters, and maximum output tokens;
- initial per-user UTC-day request/token limits;
- initial instance UTC-month request/token budgets; and
- maximum concurrent generations.

`pnpm db:deploy` stores the initial quota values idempotently. Later
administrator edits are authoritative and are not overwritten by another
deploy. Administrators can update/reset global settings at `/admin/usage` and
set a per-user daily override at `/admin/users`. A reset restores the stored
deployment defaults. User limits reset at the next UTC day; instance budgets
reset at the next UTC month. Request and token exhaustion are reported
separately for both scopes.

Administration exposes counts, token totals, outcomes, retry counts, latency,
model IDs, and provider failure categories only. It never exposes prompts,
message text, provider credentials, or raw provider bodies.

## Characters and administration

Anonymous visitors can browse `/characters` and `/characters/<slug>`.
Only active characters with an explicitly selected default published version
are public. Unknown, archived, and not-yet-defaulted character URLs return 404.
Anonymous pages do not expose chat or historical-version selection. Signed-in
users can start or continue a conversation from an active character detail.

Sign in with the CLI-created administrator account, then use:

- `/admin`: administration home;
- `/admin/characters`: lifecycle, draft, default, and latest-version overview;
- `/admin/characters/new`: create a character with a unique, permanent slug;
- `/admin/characters/<id>`: edit, publish, select a default, archive, or restore;
- `/admin/characters/<id>/preview`: preview the **saved** draft's real catalog
  card, detail view, and structured character package;
- `/admin/users`: search ordinary users, manage quota overrides, and disable or
  restore access;
- `/admin/usage`: manage global chat settings and inspect aggregate usage; and
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
administrator saves first, copy your edits, reload, and reconcile the changes
rather than overwriting them. Server refreshes never silently advance the base
revision of local edits. Validation, database, and conflict errors retain all
entered fields; only confirmed saves or publications advance that editor's
revision. Example conversations have paired user/assistant inputs with labeled
add/remove controls, bounded to one through six pairs.

Publishing validates the content and the avatar's availability, rejects an
unchanged package, and appends an immutable numbered snapshot. It retains the
draft as the base for further editing. **Publishing never selects the default.**
Use the version-history controls to explicitly choose a published version.
Public reads then use that version; older snapshots remain loadable by ID.
The Phase 3 integration contracts are `resolveDefaultCharacterVersion` for a
new conversation and `getPublishedCharacterVersion` for an existing version.
Publisher attribution is a durable, nullable user ID in the immutable snapshot,
not a live foreign key. An administrator can complete the normal verified
account-deletion flow without changing a version's content, attribution, or
digest. Mutable references and audit actor links may become null; durable audit
labels remain.

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
revokes **all** active sessions and rejects subsequent sign-ins. PostgreSQL
serializes session insertion with disabling: an in-flight sign-in either
creates its session first and has it revoked, or is rejected after disabling.
Authoritative session reads and protected routes also reject retained sessions
for banned users; signed-cookie caching is disabled. Restoring
clears the disabled state; the user must sign in again. There is no timed ban
or automatic expiration. Administrators cannot disable themselves or other
administrators through these controls.

Character creation, draft saves, publication, default changes, archive/restore,
and user disable/restore write audit events atomically with their state changes.
Each service also re-reads and share-locks the acting user inside its write
transaction, requiring the current role to be exactly `admin` and the user not
to be banned. Server-action guards remain in place; a stale or forged actor
object cannot authorize a write after demotion or disabling.
Events retain the actor label, target, operation ID, timestamp, and small
metadata such as version numbers, lifecycle state, and changed field names.
Audit pages and operational logs must not copy full character packages,
disable-reason text, passwords, tokens, or private user content. A disable
reason is stored in the authentication ban record, not displayed in the audit
view; audit is not a private-message inspection interface.

Phase 3 deliberately excludes long-term memory, user-created/shared characters,
marketplace/social features, avatar uploads/object storage, public history
browsing, web administrator-role management, automatic ban expiry, voice,
image generation, RAG, plugins, billing, and relationship levels.

## Service health

Health endpoints:

- Liveness: `http://127.0.0.1:3000/api/health/live`
- Readiness: `http://127.0.0.1:3000/api/health/ready`

Readiness reports `database`, `worker`, and `modelConfiguration` checks. Model
readiness validates the already-local URL/key/model configuration shape only;
it never calls the provider. A provider outage can fail chat requests without
making the non-chat site unready. Readiness also includes a fresh worker
heartbeat and persisted SMTP delivery health. A failed delivery makes
`worker: "error"` even while the worker is alive. Jobs remain retryable; a
later successful SMTP delivery restores health. Heartbeats, restarts, and
synthetic no-op jobs do not clear a recorded delivery failure. The public
response never includes infrastructure, email, or model-provider details.

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
loopback-only deterministic model server, independently of your shell's
SMTP/auth/model variables. The fake model listens only on `127.0.0.1:3102`,
exists only under `tests/e2e`, and has no production service or control
surface. Scenario markers include `[stream]`, `[slow]`, `[interrupt]`,
`[rate-limit]`, and `[auth-fail]`; `[stall]` supports deterministic stop and
refresh acceptance. Playwright uses `tests/e2e/app.config.yml` to keep timeout
tests fast while the fake provider's slow scenario remains deterministic.

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

Phase 3 E2E tests use one worker and unique public registrations verified through
Mailpit. A test-only, loopback/`_test`-guarded helper promotes only the newly
verified account, revokes its sessions, and signs in through the public UI.
It is not a production bootstrap bypass. Tests never edit seed characters.
Cleanup archives only owned test-created characters and removes fixture
sessions/credentials while retiring the fixture accounts. Immutable versions,
publisher identities, and audit history are intentionally retained, not deleted
by disabling integrity triggers. Do not run concurrent suites on this database.

Full release gate (with the test database configured as above):

```bash
pnpm install --frozen-lockfile
pnpm db:test:up
pnpm db:deploy
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm db:deploy
pnpm test:e2e
pnpm db:generate
git diff --exit-code -- drizzle
git diff --check
pnpm exec tsc --version
node -e 'import("typescript").then((ts) => console.log(ts.version))'
```

Every command must pass; Drizzle must report no schema changes and create no
migration. Run `db:deploy` immediately before Playwright because integration
tests can truncate seeds. The compiler commands must print `Version 7.0.2` and
`6.0.3`. The lint toolchain uses the TypeScript 7 compiler plus the official
TypeScript 6 API compatibility package, so `pnpm lint` runs the full source
lint without a TypeScript 7 compiler-API startup exception. Do not downgrade
the compiler, bypass preflight, disable lint rules, or substitute a different
tooling API to claim a green gate. `pnpm build` runs native TypeScript 7
preflight typechecking before `next build`.

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
