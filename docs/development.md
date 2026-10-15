# Development and testing

This guide describes the supported toolchain, guarded test infrastructure,
browser gates, and contribution checks.

## Toolchain

Use:

- Node.js 24.x;
- pnpm 12.5.1;
- PostgreSQL 16; and
- Docker with Docker Compose for integration and browser tests.

Install exactly from the lockfile:

```bash
corepack enable
corepack prepare pnpm@12.5.1 --activate
pnpm install --frozen-lockfile
```

The workspace `tsc` binary resolves through `@typescript/native` to the
TypeScript 7 compiler. Tooling that imports the `typescript` package uses the
pinned TypeScript 6 compatibility API. Keep the existing `pnpm typecheck` and
`pnpm build` commands; do not downgrade, bypass preflight, or replace the
compiler arrangement to make a check pass.

## Guarded test services

Start PostgreSQL and Mailpit:

```bash
pnpm db:test:up
```

The services listen on:

- PostgreSQL: `127.0.0.1:55432`, database `companion_test`
- SMTP: `127.0.0.1:1025`
- Mailpit UI: <http://localhost:8025>

Database-backed tests require a loopback PostgreSQL database whose name ends in
`_test` and whose URL has no query overrides. Set:

```dotenv
DATABASE_URL=postgresql://companion:companion@127.0.0.1:55432/companion_test
TEST_DATABASE_URL=postgresql://companion:companion@127.0.0.1:55432/companion_test
```

Unsafe database targets are rejected before destructive test SQL runs. Do not
run concurrent suites against the same test database, and never point these
commands at production.

Stop and delete only the guarded test data:

```bash
pnpm db:test:down
```

## Core checks

Run:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Vitest includes unit, component, database integration, queue, concurrency, and
privacy-boundary coverage.

## Browser tests

Seed immediately before each Playwright run because integration tests can
truncate shared seed data:

```bash
pnpm db:deploy
pnpm test:e2e
```

Playwright supplies the same fixed environment to its app, worker, and
loopback-only deterministic model provider. The provider listens only on
`127.0.0.1:3102` during browser tests and is not a production service.

Run the Clear Daylight gates:

```bash
pnpm db:deploy
pnpm test:e2e:visual
pnpm test:e2e:a11y
```

The visual gate covers desktop light/dark, mobile reduced motion, 320px,
200% browser scaling, no-JavaScript rendering, error states, dialogs, and
representative product surfaces. The accessibility gate runs Axe and verifies
keyboard navigation, Escape handling, focus trapping, and focus restoration.

Screenshots, traces, captured responses, decoded exports, and privacy evidence
contain synthetic private test data. They are Git-ignored and must not be
published or attached outside the controlled review process.

## Database schema changes

After changing Drizzle schemas:

```bash
pnpm db:generate
```

Review the generated migration and verify:

```bash
git diff --exit-code -- drizzle
```

The command above is expected to be clean when no schema change was intended.

## Release validation

The complete release sequence is:

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
pnpm exec tsx tests/release/database-gate.ts
pnpm exec tsx tests/release/compose-gate.ts
cp .superpowers/release-compose/app.log \
  test-results/privacy-release/app-logs/production.log
cp .superpowers/release-compose/worker.log \
  test-results/privacy-release/worker-logs/production.log
pnpm exec tsx tests/release/privacy-scan-cli.ts
```

Use Node 24.x for the entire gate. Run heavyweight build, browser, and Compose
gates sequentially on small Docker hosts to avoid resource contention.

The database gate checks fresh and upgrade paths against all migration hashes
and public schema objects. The production Compose gate extends the real
`docker-compose.yml`, starts an isolated provider and database, validates old
data, and exercises new chat, memory, export, lockout, and purge behavior.

The privacy scanner requires complete app, worker, HTTP, static asset, browser,
and decoded export evidence. It searches for deterministic provider, endpoint,
other-user, and private-memory sentinels and fails when required evidence is
missing.

## Contribution workflow

1. Create a focused branch from current `main`.
2. Keep changes scoped and follow existing patterns.
3. Add or update tests for behavior changes.
4. Update directly related documentation.
5. Run the smallest relevant checks, then the core checks before opening a PR.
6. Ensure `git diff --check` is clean.
7. Open a pull request with a concise behavior summary, validation evidence,
   privacy impact, and deployment or migration notes.

Never commit `.env`, credentials, captured privacy artifacts, generated
archives, production data, or provider responses.
