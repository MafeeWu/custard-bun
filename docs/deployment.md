# Deployment and operations

Custard Bun ships a production Docker Compose stack containing PostgreSQL, a
one-shot migration job, the background worker, and the web application.

## Production configuration

Create and secure the environment file:

```bash
cp .env.example .env
```

Replace every placeholder. Model configuration is runtime-only and is never a
public build argument or browser setting.

`POSTGRES_PASSWORD` can contain URI delimiters, spaces, literal `%2F`, and `$`.
Use a single-quoted dotenv value so Compose does not expand it:

```dotenv
POSTGRES_PASSWORD='replace/ ? # @ %2F $literal space'
```

Do not pre-encode the password. The container entrypoint constructs and
percent-encodes `DATABASE_URL` at runtime. Escape a literal single quote as
`\'`, and do not source `.env` as shell code.

Configure `app.config.yml` for:

- branding and public links;
- registration policy;
- chat timeouts, quotas, budgets, and concurrency; and
- memory, summary, retry, export, and retention limits.

The file is mounted read-only into the application, worker, and migration job.

## Start the stack

Build, migrate, seed, and start:

```bash
docker compose up -d --build
```

The same pinned production image is used by the migration job, worker, and app.
The image runs the Node 24 and TypeScript preflight during build and does not
install or resolve a new dependency graph during startup.

Check service state:

```bash
docker compose ps
docker compose logs app
docker compose logs worker
```

## Create an administrator

Create the first administrator after the services are healthy:

```bash
docker compose exec app /bin/sh /app/scripts/docker-entrypoint.sh \
  pnpm exec auth create-admin \
  --config src/server/auth/auth-cli.ts \
  --email admin@example.com \
  --name "Admin" \
  --role admin
```

The CLI is the administrator bootstrap and role-management boundary. The web
interface does not expose role editing or invitations.

## Migrations and seeds

Run the migration job independently:

```bash
docker compose run --rm migrate
```

It executes `pnpm db:deploy`, which:

1. applies database migrations;
2. seeds official characters;
3. seeds initial chat settings; and
4. seeds initial memory settings.

The operation is safe to repeat. Existing official characters, drafts,
published snapshots, default pointers, lifecycle state, and administrator
settings are preserved. Reserved slug or stable ID conflicts fail and roll
back rather than partially changing the catalog.

## Supported HTTP boundary

`pnpm start` is the supported production server. It validates the complete
runtime configuration before listening and replaces forwarding identity
headers with the real TCP peer identity used by authentication rate limits.

Do not replace it with `next start`, and do not expose `pnpm dev` publicly.
An upstream proxy or NAT is treated as one peer; forwarded client identity
headers are intentionally not trusted.

## Health checks

Endpoints:

- Liveness: `/api/health/live`
- Readiness: `/api/health/ready`

Readiness checks the database, registered worker heartbeat, model configuration
shape, and persisted SMTP delivery health. It does not call the model provider.
A provider outage can therefore fail chat while the rest of the application
remains ready.

The public response reports only safe component status and never includes
credentials or infrastructure details.

## Logs

Use:

```bash
docker compose logs -f app
docker compose logs -f worker
docker compose logs -f postgres
```

Application and worker logs are designed to remain content-free. Do not add
prompts, messages, memory text, structured candidates, provider bodies,
credentials, export bytes, or other private content to logs.

## Upgrade

Before upgrading:

1. back up PostgreSQL and `app.config.yml`;
2. preserve `.env` in the secret-management system; and
3. review configuration changes in `.env.example` and `app.config.yml`.

Then update the checkout and rebuild:

```bash
git pull --ff-only
docker compose up -d --build
```

The migration job runs before the new app and worker become healthy.

## Backup and restore

Back up:

- the PostgreSQL database, which contains accounts, conversations, memory,
  exports, audit records, settings, and durable jobs;
- `app.config.yml`, which defines the public instance identity and policy; and
- `.env`, stored only in an appropriate secrets system.

Test restoration procedures before relying on backups. Application account
purge cannot remove copies retained by external backups or by the configured
model provider.

## Stop or remove the stack

Stop and remove containers while keeping the named database volume:

```bash
docker compose down
```

Deleting the volume is destructive and permanently removes application data.
Do not use `docker compose down -v` unless that is explicitly intended and a
verified backup exists.

## Operational boundaries

- The worker registers email, memory extraction, relationship summary, export,
  export expiry, and account purge queues before it reports readiness.
- PostgreSQL is the source of truth for durable operation state; queue delivery
  is only a wake-up mechanism.
- Background model work consumes the instance monthly token budget, not user
  daily chat quotas.
- Administrative usage and operations pages expose aggregate totals and safe
  failure categories, never prompts, transcripts, memory text, archives,
  provider credentials, or raw provider responses.

For user-facing behavior and privacy guarantees, read
[Features and privacy](features-and-privacy.md).
