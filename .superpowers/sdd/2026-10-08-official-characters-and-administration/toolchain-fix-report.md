# TypeScript lint toolchain fix report

## Summary

Implemented the bounded lint-toolchain fix as TypeScript 7 compiler + official TypeScript 6 API compatibility package.

Ruling: `@typescript/typescript6@6.0.3` is not published on the configured npm registry (`pnpm view @typescript/typescript6 versions --json` returned only `6.0.0`, `6.0.1`, `6.0.2`; direct tarball probe for 6.0.3 returned HTTP 404). Used the published official wrapper `@typescript/typescript6@6.0.2`, which imports `@typescript/old` as `typescript@6.0.3` and exposes `typescript.version === "6.0.3"`. Cost if wrong: the manifest alias differs from the originally approved exact wrapper version, although runtime API and compiler behavior match the acceptance contract.

## RED

Command:

```bash
pnpm test src/test/typescript-toolchain.test.ts
```

Result: exit 1, expected RED.

Evidence: `uses TypeScript 7 compiler with official TypeScript 6 tool API compatibility` failed because `dependencySpec("typescript")` was `"7.0.2"` instead of the required compatibility-package alias. Counts: 1 failed test file; 1 failed, 1 passed test.

## GREEN

Command:

```bash
pnpm test src/test/typescript-toolchain.test.ts
```

Result: exit 0.

Counts: 1 passed test file; 2 passed tests.

## Toolchain checks

- `pnpm exec tsc --version`: exit 0, output `Version 7.0.2`.
- `node -e "import('typescript').then(ts=>console.log(ts.version))"`: exit 0, output `6.0.3`.
- `pnpm lint`: exit 0; source lint executed with 0 errors and 8 warnings after cleanup. No typescript-eslint startup exception.

## Full release gate

- `pnpm db:test:up`: exit 0. PostgreSQL and Mailpit containers healthy.
- `pnpm db:deploy`: exit 0. Migration ran; character seeding complete: created 0, existing 5.
- `pnpm test`: exit 0. Counts: 75 passed test files; 316 passed tests.
- `pnpm typecheck`: exit 0. `next typegen` generated route types; `tsc --noEmit` passed.
- `pnpm lint`: exit 0. Source lint executed; 0 errors, 11 warnings at the full-gate point.
- `pnpm build`: exit 0. Next.js production build compiled successfully and generated route output.
- Second `pnpm db:deploy` immediately before E2E: exit 0. Migration ran; character seeding complete: created 5, existing 0.
- `pnpm test:e2e`: exit 0. Counts: 9 passed Playwright tests.
- Schema drift: `pnpm exec drizzle-kit generate --name final_schema_drift_check`: exit 0. Output `No schema changes, nothing to migrate 😴`; drizzle file count before=11 after=11.
- `git diff --check`: exit 0.

## Post-roadmap/doc edits affected checks

After clearing the roadmap blocked status and README release-blocker wording:

- `pnpm test src/test/typescript-toolchain.test.ts`: exit 0. Counts: 1 passed test file; 2 passed tests.
- `pnpm exec tsc --version`: exit 0, output `Version 7.0.2`.
- `node -e "import('typescript').then(ts=>console.log(ts.version))"`: exit 0, output `6.0.3`.
- `pnpm lint`: exit 0; 0 errors, 11 warnings.
- `pnpm test src/app/admin/characters/page.test.tsx src/app/admin/users/page.test.tsx`: exit 0. Counts: 2 passed test files; 3 passed tests.
- Final `pnpm lint`: exit 0; 0 errors, 8 warnings.
- Final `git diff --check`: exit 0.

## Documentation updates

- README prerequisites and release-gate notes describe TypeScript 7 compiler + official TypeScript 6 API compatibility package.
- Phase 2 design technical constraints describe the compiler/API split.
- Phase 2 implementation plan Tech Stack and Global Constraints describe the compiler/API split.
- Roadmap Phase 2 status moved from blocked to complete after the full gate passed.

## Concerns

`@typescript/typescript6@6.0.3` is not published. The committed manifest uses `typescript: npm:@typescript/typescript6@6.0.2`, whose dependency exposes the required TypeScript 6.0.3 compiler API. The workspace compiler remains `@typescript/native: npm:typescript@7.0.2` and `pnpm exec tsc --version` returns 7.0.2.

## Fix Round 1

Addressed the Important finding that Docker only exercised `pnpm build` while
Next 16 could still resolve its internal compiler from the `typescript`
package name during `next build`.

### TDD

- RED: `pnpm test src/test/typescript-toolchain.test.ts` exited 1.
  `build runs native TypeScript 7 typecheck before next build and Docker uses
  that entry point` failed because `packageJson.scripts.build` was `next build`
  instead of `pnpm typecheck && next build`.
- GREEN: updated `package.json` build to `pnpm typecheck && next build`.
  `pnpm test src/test/typescript-toolchain.test.ts` then exited 0 with
  1 passed file and 3 passed tests.

### Fix

- Production `pnpm build` now runs the existing TypeScript 7 preflight
  `pnpm typecheck` before `next build`.
- Docker still invokes `RUN pnpm build && rm -rf .next/cache`, so image builds
  inherit the same native TypeScript 7 preflight.
- Official aliases, versions, lint coverage, and Next's own build/type checks
  remain enabled and unchanged.

### Documentation updates

- `README.md` now states that production `pnpm build` runs native TypeScript 7
  before `next build`, while Next/tooling may still import the official
  TypeScript 6 compatibility package.
- The Phase 2 design spec and implementation plan now document the same
  production-build/tooling split.

### Verification

- `pnpm exec tsc --version`: exit 0, output `Version 7.0.2`.
- `node -e "import('typescript').then((ts) => console.log(ts.version))"`:
  exit 0, output `6.0.3`.
- `pnpm lint`: exit 0 with 0 errors and 8 warnings.
- `pnpm db:test:up`: exit 0; PostgreSQL and Mailpit healthy.
- First `pnpm db:deploy`: exit 0; seeding reported `created 5, existing 0`.
- `pnpm test`: exit 0 with 75 passed files and 317 passed tests.
- `pnpm build`: exit 0; reported both stages:
  - `pnpm typecheck && next build`
  - `next typegen && tsc --noEmit`
  - Next then compiled successfully and finished its own TypeScript pass.
- Second `pnpm db:deploy` immediately before E2E: exit 0; seeding again
  reported `created 5, existing 0`.
- `pnpm test:e2e`: exit 0 with 9 passed Playwright tests.
- `pnpm exec drizzle-kit generate --name final_schema_drift_check`: exit 0,
  output `No schema changes, nothing to migrate 😴`; drizzle file count stayed
  5 before/after.
- `git diff --check`: exit 0.
