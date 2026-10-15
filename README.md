# Custard Bun

Custard Bun is a self-hosted web application for private, streamed AI
companion conversations. Deployers control the branding, registration policy,
OpenAI-compatible model provider, email service, quotas, official characters,
and memory limits.

The application includes:

- streamed, version-pinned character conversations with stop and retry;
- deployer-managed official characters and administration tools;
- long-term memory and relationship summaries with user controls;
- private account data exports and restartable account deletion;
- aggregate-only usage and operations views; and
- the responsive Clear Daylight interface with light, dark, reduced-motion,
  keyboard, and narrow-screen support.

## Requirements

Choose one of these environments:

- Docker with Docker Compose; or
- Node.js 24.x, pnpm 12.5.1, and PostgreSQL 16.

You also need an SMTP server and an OpenAI-compatible model endpoint.

## Run locally

The quickest production-like local setup uses Docker Compose:

```bash
cp .env.example .env
```

Review every value in `.env` and replace the credentials, SMTP settings, model
URL, API key, and model ID for your environment. Then customize the site name,
logo, public links, registration policy, quotas, and memory limits in
`app.config.yml`.

Start the database, migration job, worker, and web application:

```bash
docker compose up --build
```

Open <http://localhost:3000>. Stop the stack with:

```bash
docker compose down
```

For a source-based development setup, test email inbox, and troubleshooting,
see [Getting started](docs/getting-started.md).

## Deploy

1. Copy `.env.example` to `.env` and replace every placeholder with a
   production secret or endpoint.
2. Configure branding and operating limits in `app.config.yml`.
3. Start the production stack:

   ```bash
   docker compose up -d --build
   ```

4. Create the first administrator:

   ```bash
   docker compose exec app /bin/sh /app/scripts/docker-entrypoint.sh \
     pnpm exec auth create-admin \
     --config src/server/auth/auth-cli.ts \
     --email admin@example.com \
     --name "Admin" \
     --role admin
   ```

Do not expose `pnpm dev` publicly or replace the supported `pnpm start`
boundary with `next start`. Back up PostgreSQL and `app.config.yml`, and keep
`.env` in a secret-management system.

See [Deployment and operations](docs/deployment.md) for proxy behavior,
migrations, health checks, upgrades, backups, and operational guidance.

## Contributing

1. Fork and clone the repository.
2. Create a focused branch from `main`.
3. Install the pinned dependencies:

   ```bash
   corepack enable
   corepack prepare pnpm@12.5.1 --activate
   pnpm install --frozen-lockfile
   ```

4. Make the change with tests and directly related documentation.
5. Run the relevant checks:

   ```bash
   pnpm test
   pnpm typecheck
   pnpm lint
   pnpm build
   ```

6. Push the branch and open a pull request describing the behavior change,
   validation performed, and any deployment impact.

Database-backed and browser tests use guarded local infrastructure and require
additional setup. Read [Development and testing](docs/development.md) before
running them. Never point test commands at a production database.

## Documentation

- [Getting started](docs/getting-started.md) — configuration and local
  development
- [Deployment and operations](docs/deployment.md) — production Compose,
  administrators, health, upgrades, and backups
- [Features and privacy](docs/features-and-privacy.md) — chat, characters,
  memory, exports, deletion, and privacy boundaries
- [Development and testing](docs/development.md) — toolchain, tests, browser
  gates, and release validation
- [Design specifications](docs/superpowers/specs/) — detailed architectural
  decisions
- [Implementation plans](docs/superpowers/plans/) — phased implementation
  history
