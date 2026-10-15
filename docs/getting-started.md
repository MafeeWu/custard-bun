# Getting started

This guide covers configuration and local development. For a production
deployment, read [Deployment and operations](deployment.md).

## Prerequisites

Use Node.js 24.x and pnpm 12.5.1:

```bash
corepack enable
corepack prepare pnpm@12.5.1 --activate
pnpm install --frozen-lockfile
```

You also need Docker for the guarded PostgreSQL and Mailpit development
services, plus an OpenAI-compatible model endpoint for normal local chat.

## Configure the environment

Create the local environment file:

```bash
cp .env.example .env
```

Review every value and replace the credentials, SMTP settings, model URL, API
key, and model ID for your environment. The important settings are:

| Variable             | Purpose                                                 |
| -------------------- | ------------------------------------------------------- |
| `POSTGRES_PASSWORD`  | Production Compose database password                    |
| `BETTER_AUTH_SECRET` | Authentication signing secret of at least 32 characters |
| `BETTER_AUTH_URL`    | Public application origin                               |
| `SMTP_*`             | Outbound email connection and sender                    |
| `MODEL_API_BASE_URL` | OpenAI-compatible API root, before `chat/completions`   |
| `MODEL_API_KEY`      | Server-side model provider credential                   |
| `MODEL_ID`           | Provider model identifier                               |

Normal source-based development also requires a percent-encoded
`DATABASE_URL`. The shared guarded test database is:

```dotenv
NODE_ENV=development
DATABASE_URL=postgresql://companion:companion@127.0.0.1:55432/companion_test
BETTER_AUTH_URL=http://127.0.0.1:3000
SMTP_HOST=127.0.0.1
SMTP_PORT=1025
SMTP_SECURE=false
```

Keep `.env` private. Prompts sent to the configured model can include character
instructions and the user's current or recent conversation content. Only use a
provider you trust and review its retention, training, residency, and access
policies.

## Configure the instance

`app.config.yml` contains deployer-owned public and operating configuration:

- site name, description, logo, favicon, and accent color;
- registration availability and rate limits;
- privacy, terms, and support links;
- chat timeouts, prompt limits, output limits, quotas, and concurrency; and
- memory, summary, retry, export retention, and archive size limits.

Compose mounts this file at runtime. Configuration changes require a service
restart, not an image rebuild.

Official character avatars live in `public/characters`. Published avatar paths
must remain immutable: add a new file and publish a new character version
instead of overwriting an existing asset.

## Run with Docker Compose

For the shortest production-like local setup:

```bash
docker compose up --build
```

Open <http://localhost:3000>. The migration job applies all migrations and
idempotently seeds the official characters and initial settings before the app
and worker become healthy.

Stop the stack without deleting its database volume:

```bash
docker compose down
```

## Run from source

Start the guarded PostgreSQL and Mailpit services:

```bash
pnpm db:test:up
```

Apply migrations and seed data:

```bash
pnpm db:deploy
```

Run the application and worker in separate terminals:

```bash
pnpm dev
```

```bash
pnpm worker
```

Open:

- Application: <http://localhost:3000>
- Mailpit: <http://localhost:8025>

The development stack does not provide a general-purpose fake chat model.
Configure a trusted OpenAI-compatible endpoint in `.env`. Playwright starts its
own deterministic, loopback-only provider for browser tests.

Stop and remove the guarded test services and their test data:

```bash
pnpm db:test:down
```

## Useful database commands

```bash
pnpm db:migrate
pnpm db:seed:characters
pnpm db:seed:chat-settings
pnpm db:seed:memory-settings
pnpm db:deploy
```

`db:deploy` runs all four operations. Seeds are idempotent and do not overwrite
administrator-managed character drafts, published versions, default pointers,
or edited quota settings.

## Next steps

- Production setup: [Deployment and operations](deployment.md)
- Product behavior: [Features and privacy](features-and-privacy.md)
- Tests and contribution checks: [Development and testing](development.md)
