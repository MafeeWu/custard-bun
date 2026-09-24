# Task 2 Report — Strict Runtime Configuration and Branding

## Commit
- `a0dc81b` — `feat: add strict runtime branding configuration`

## RED / GREEN Evidence

### RED
Command:
```bash
pnpm test src/server/config/load-config.test.ts src/app/page.test.tsx
```
Initial result before implementation:
- failed with `Error: Failed to resolve import "./load-config" from "src/server/config/load-config.test.ts"`
- exit code `1`

### GREEN
Command:
```bash
pnpm test src/server/config/load-config.test.ts src/app/page.test.tsx
```
Result after implementation:
- `2` test files passed
- `5` tests passed
- exit code `0`

Command:
```bash
pnpm test
```
Result:
- `2` test files passed
- `5` tests passed
- exit code `0`

Command:
```bash
pnpm typecheck
```
Result:
- `next typegen` succeeded
- `tsc --noEmit` succeeded
- exit code `0`

Command:
```bash
pnpm lint
```
Result:
- `eslint .` succeeded
- exit code `0`

Command:
```bash
APP_CONFIG_PATH=app.config.yml NODE_ENV=test DATABASE_URL='postgresql://companion:test@127.0.0.1:55432/companion' BETTER_AUTH_SECRET='test-secret-that-is-at-least-32-characters' BETTER_AUTH_URL='http://127.0.0.1:3000' SMTP_HOST='127.0.0.1' SMTP_PORT='1025' SMTP_SECURE='false' SMTP_USER='test' SMTP_PASSWORD='test' SMTP_FROM='Custard Bun <noreply@example.com>' pnpm build
```
Result:
- production build succeeded
- exit code `0`

Command:
```bash
APP_CONFIG_PATH=app.config.yml NODE_ENV=test DATABASE_URL='postgresql://companion:test@127.0.0.1:55432/companion' BETTER_AUTH_SECRET=short BETTER_AUTH_URL='http://127.0.0.1:3000' SMTP_HOST='127.0.0.1' SMTP_PORT='1025' SMTP_SECURE='false' SMTP_USER='test' SMTP_PASSWORD='test' SMTP_FROM='Custard Bun <noreply@example.com>' pnpm build
```
Result:
- build failed as expected
- error contained `environment.BETTER_AUTH_SECRET: Too small: expected string to have >=32 characters`
- exit code `1`

## Files Changed
- `.env.example`
- `app.config.yml`
- `public/brand/favicon.svg`
- `public/brand/logo.svg`
- `src/app/layout.tsx`
- `src/app/page.tsx`
- `src/app/page.test.tsx`
- `src/components/brand/brand-mark.tsx`
- `src/server/config/load-config.ts`
- `src/server/config/load-config.test.ts`
- `src/server/config/public-config.ts`
- `src/server/config/schema.ts`
- `src/test/unit/runtime-config-fixture.ts`

## Self-Review
- Public runtime configuration is strict and YAML-driven with `.strict()` schemas, so unknown keys fail fast.
- Secret environment values stay in the server-only loader and are not exposed to client components.
- Branding is request-time through dynamic route handling, so the app does not bake branding into the build.
- The landing-page test renders the server component output using a mocked public-config loader, which keeps secrets out of the test UI path.
- Build validation now fails on the exact secret field requested.

## Concerns
- Runtime config is cached per process after the first load, so a changed mounted `app.config.yml` is observed after restart, not mid-process.

## Fix Round 1

### Commit
- `24aae57` — `fix: wrap YAML syntax errors in controlled app.config.yml error path`

### RED / GREEN Evidence

#### RED
Command:
```bash
pnpm test src/server/config/load-config.test.ts
```
Result before implementation:
- Failed with `AssertionError: expected [Function] to throw error matching /^app\.config\.yml\.<root>:/ but got 'Nested mappings are not allowed in co…'`
- Raw `YAMLParseError` thrown directly by parser without controlled `app.config.yml.<root>:` prefix wrapper
- Exit code `1`

#### GREEN
Command:
```bash
pnpm test src/server/config/load-config.test.ts
```
Result after implementation:
- `1` test file passed (`5` tests passed)
- Exit code `0`

Command:
```bash
pnpm test
```
Result:
- `2` test files passed (`6` tests passed)
- Exit code `0`

Command:
```bash
pnpm typecheck
```
Result:
- `next typegen` succeeded
- `tsc --noEmit` succeeded
- Exit code `0`

Command:
```bash
pnpm lint
```
Result:
- `eslint .` succeeded
- Exit code `0`

Command:
```bash
APP_CONFIG_PATH=app.config.yml NODE_ENV=test DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:55432/companion' BETTER_AUTH_SECRET='test-secret-that-is-at-least-32-characters' BETTER_AUTH_URL='http://127.0.0.1:3000' SMTP_HOST='127.0.0.1' SMTP_PORT='1025' SMTP_SECURE='false' SMTP_USER='test' SMTP_PASSWORD='test' SMTP_FROM='Custard Bun <noreply@example.com>' pnpm build
```
Result:
- Production build succeeded
- Exit code `0`

### Files Changed
- `src/server/config/load-config.ts`
- `src/server/config/load-config.test.ts`
- `.superpowers/sdd/2026-09-23-foundation-and-accounts/task-2-report.md`

### Self-Review & Verification
- `parse(source)` calls are wrapped in a try/catch block that formats syntax errors as `app.config.yml.<root>: Invalid YAML syntax: <reason>`.
- Schema validation and filesystem errors preserve their exact existing error messages.
- Full test suite, TypeScript typecheck, ESLint, and Next.js production build all pass cleanly.

