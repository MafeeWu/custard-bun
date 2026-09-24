# Custard Bun

Custard Bun is a self-hosted foundation for private AI companion
conversations. Phase 1 provides runtime branding, account registration,
email verification, password recovery, account deletion, and deployable
application and worker processes.

Chat, characters, and long-term memory arrive in later phases. Model
credentials will remain server-only when model integrations are added.

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
pnpm db:migrate
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
pnpm test:e2e
pnpm db:test:down
```

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
