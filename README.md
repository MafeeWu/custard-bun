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

`POSTGRES_PASSWORD` may contain URI delimiters such as `/`, `?`, `#`, `@`, and
spaces. Keep the value quoted in `.env`; the production entrypoint constructs
and percent-encodes `DATABASE_URL` at runtime without storing a second copy of
the password.

## Deploy with Docker Compose

Build, migrate, and start PostgreSQL, the email worker, and the web app:

```bash
docker compose up --build
```

The same production image is used for the migration job, worker, and app.

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

## Backups and operations

Back up both the PostgreSQL database and `app.config.yml`. The database holds
accounts and durable jobs; the YAML file holds the instance identity and
public operating policy. Store `.env` securely in your secret-management
system and test restoration procedures before relying on backups.

Stop the production stack with:

```bash
docker compose down
```
