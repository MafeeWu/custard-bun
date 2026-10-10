# Task 1 Report — Add Memory Configuration, Contracts, Normalization, and Sensitive-Data Policy

## Implementation summary
- Added the public `memory` deployment config block to `app.config.yml`, runtime config fixtures, and the Zod runtime schema, including cross-field validation for prompt budgets, strict unknown-key rejection, fixed 24-hour export retention, and limits for item/archive sizes.
- Added `fflate@0.8.3` and bumped the `typescript` alias from `npm:@typescript/typescript6@6.0.2` to `npm:@typescript/typescript6@6.0.3` while preserving `@typescript/native` at `7.0.2`; updated the toolchain verification test accordingly.
- Implemented strict provider-facing memory contracts in `src/server/memory/memory-contracts.ts` using `.strict()` schemas, a 20-candidate cap, UUID/enum/range validation, raw-content preservation, and explicit rejection of provider-controlled `normalizedContent`.
- Implemented local normalization/digest generation in `src/server/memory/memory-normalization.ts` with Unicode NFKC normalization, whitespace collapse, trimming, and digest lowercasing only for the SHA-256 input.
- Implemented the tiered sensitive-data policy in `src/server/memory/memory-policy.ts`, including local rejection of credential-class secrets, payment cards via Luhn validation, explicit banking-auth patterns, and the `personal_explicit` + explicit-intent guard.
- Added focused test coverage for config loading, contract parsing, normalization, and sensitive-policy behavior; also made the auth integration suite self-seed `chat_settings` so the full suite stays deterministic under parallel execution.

## RED evidence
### Brief command attempt
```bash
pnpm vitest run src/server/config/load-config.test.ts src/server/memory/memory-contracts.test.ts src/server/memory/memory-normalization.test.ts src/server/memory/memory-policy.test.ts
```
- Result: blocked by `ERR_PNPM_TARBALL_HTTP_STATUS` / npm 404 for `https://registry.npmjs.org/@typescript/typescript6/-/typescript6-6.0.3.tgz` after the required alias bump.
- Why it failed: the brief requires the `6.0.3` alias, but `pnpm` script execution in this environment tries to resolve that unpublished tarball before running the script.

### Verified RED command used for TDD
```bash
node_modules/.bin/vitest run src/server/config/load-config.test.ts src/server/memory/memory-contracts.test.ts src/server/memory/memory-normalization.test.ts src/server/memory/memory-policy.test.ts
```
- Result: 19 failed tests, 6 passed; 3 suites failed to load.
- Relevant expected failures:
  - `app.config.yml.<root>: unknown configuration key` because the runtime schema did not yet accept `memory`.
  - `Failed to resolve import "./memory-contracts"` / `"./memory-normalization"` because the memory modules did not yet exist.
- Why it failed: this was the intended RED state before implementing the Task 1 config and memory modules.

### Additional RED→GREEN cycle
```bash
node_modules/.bin/vitest run src/server/memory/memory-contracts.test.ts
```
- Result before fix: 1 failed, 11 passed.
- Relevant failure: parser trimmed provider content instead of preserving the raw candidate for later local normalization.
- Why it failed: `parseMemoryCandidates` used `z.string().trim()`, which violated the raw-candidate contract.

## GREEN / final verification evidence
### Focused Task 1 suite
```bash
node_modules/.bin/vitest run src/server/config/load-config.test.ts src/server/memory
```
- Result: 52/52 tests passed across 4 files.

### Static checks
```bash
node_modules/.bin/next typegen && node_modules/.bin/tsc --noEmit
```
- Result: success / exit 0.

```bash
node_modules/.bin/eslint .
```
- Result: 0 errors, 9 warnings.
- Notes: all 9 warnings were pre-existing and outside Task 1 scope (`src/app/admin/characters/actions.ts`, `src/app/admin/users/actions.ts`, `src/components/characters/character-card.tsx`, `src/components/characters/character-profile.tsx`, `src/server/chat/token-counter.ts`). No new Task 1 warnings were introduced.

### Final full suite before commit
```bash
node_modules/.bin/vitest run
```
- Result: 615/615 tests passed across 104 files.

### Completion-hook verification recorded in ledger
```bash
bash -lc 'node_modules/.bin/vitest run src/server/config/load-config.test.ts src/server/memory && node_modules/.bin/next typegen && node_modules/.bin/tsc --noEmit && node_modules/.bin/eslint .'
```
- Result: focused suite passed, type generation/typecheck succeeded, ESLint finished with `0 errors, 9 warnings`, and `task-done` recorded Task 1 complete.

## Files changed
- `package.json`
- `pnpm-lock.yaml`
- `app.config.yml`
- `.env.example`
- `src/server/config/load-config.test.ts`
- `src/server/config/schema.ts`
- `src/server/auth/auth.integration.test.ts`
- `src/test/typescript-toolchain.test.ts`
- `src/test/unit/runtime-config-fixture.ts`
- `src/server/memory/memory-contracts.ts`
- `src/server/memory/memory-contracts.test.ts`
- `src/server/memory/memory-normalization.ts`
- `src/server/memory/memory-normalization.test.ts`
- `src/server/memory/memory-policy.ts`
- `src/server/memory/memory-policy.test.ts`

## Commit
- `5efb12f feat(memory): add configuration and memory policy`

## Self-review findings
- The provider contract is strict and does not accept `normalizedContent`; raw content is preserved until local normalization, matching the preflight ruling and security constraint.
- Normalization is local-only, deterministic, and keeps display casing while lowercasing only the digest input.
- Sensitive-data rejection is locally enforced before persistence, including credential markers and Luhn-valid payment cards.
- The full suite regression in `auth.integration.test.ts` was traced to shared `chat_settings` state under parallel test execution; seeding that singleton inside the suite makes the test deterministic without changing product code.
- The toolchain verification now checks the required alias bump and the native compiler path without relying on `pnpm exec`, which is blocked by the registry-side 6.0.3 tarball gap in this environment.

## Concerns
- `pnpm` script execution is currently blocked in this environment after the required alias bump because `registry.npmjs.org` returns 404 for `@typescript/typescript6@6.0.3`. I kept the manifest and lockfile at the required version and used the already-installed local binaries for verification; fresh clean-environment `pnpm` script execution will remain blocked until that tarball is published or the resolution strategy changes.

## Correction — 2026-10-10 pre-review manifest fix
### Summary of changes
- Replaced the unpublished manifest target `npm:@typescript/typescript6@6.0.3` with official `typescript@6.0.3` in `package.json`.
- Regenerated `pnpm-lock.yaml` so the importer and all transitive TypeScript peer references now resolve to `typescript@6.0.3`, while preserving `@typescript/native` as `npm:typescript@7.0.2`.
- Updated `src/test/typescript-toolchain.test.ts` to assert the official `typescript` package spec, while continuing to verify imported API version `6.0.3` and `tsc --version` `7.0.2`.

### Root cause and RED evidence
```bash
pnpm install --frozen-lockfile
```
- Result before correction: failed with `ERR_PNPM_TARBALL_HTTP_STATUS`.
- Exact registry failure: `Tarball server returned HTTP 404 for https://registry.npmjs.org/@typescript/typescript6/-/typescript6-6.0.3.tgz`.

```bash
node_modules/.bin/vitest run src/test/typescript-toolchain.test.ts
```
- Result after updating the expectation first: `1 failed | 2 passed`.
- Exact failing assertion: `expected 'npm:@typescript/typescript6@6.0.3' to be '6.0.3'`.

### Lock regeneration / validation commands
```bash
pnpm pkg set devDependencies.typescript=6.0.3
```
- Result: `package.json` updated to the official package spec.

```bash
pnpm install --lockfile-only --force
```
- Result: completed successfully, but left the importer `version` entry pinned to the old alias.

```bash
pnpm remove --save-dev typescript --lockfile-only
pnpm add --save-dev --save-exact typescript@6.0.3 --lockfile-only
```
- Result: both commands succeeded and rewrote the lock to `specifier: 6.0.3` / `version: 6.0.3`, removing all `@typescript/typescript6` references.

```bash
pnpm install --frozen-lockfile
```
- Result after correction: success.
- Exact package delta line: `Packages: +24 -13`.
- Exact TypeScript delta: `- typescript 6.0.2` / `+ typescript 6.0.3`.

### Final verification (normal pnpm scripts)
```bash
pnpm vitest run src/test/typescript-toolchain.test.ts
```
- Result: `Test Files 1 passed (1)` / `Tests 3 passed (3)`.

```bash
pnpm vitest run src/server/config/load-config.test.ts src/server/memory
```
- Result: `Test Files 4 passed (4)` / `Tests 52 passed (52)`.

```bash
pnpm typecheck
```
- Result: `Generating route types...` / `✓ Types generated successfully` / exit 0.

```bash
pnpm lint
```
- Result: `✖ 9 problems (0 errors, 9 warnings)`.
- Warning count unchanged from the original Task 1 report and still outside this correction scope.

```bash
pnpm test
```
- Result: `Test Files 104 passed (104)` / `Tests 615 passed (615)`.

### Follow-up commit
- Follow-up commit created after this report update with the required `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>` trailer; the exact hash is provided in the final handoff because this report file cannot self-reference its own containing commit hash.

### Correction self-review
- The fix is limited to `package.json`, `pnpm-lock.yaml`, `src/test/typescript-toolchain.test.ts`, and this report addendum.
- Clean-environment `pnpm install --frozen-lockfile` now succeeds using the checked-in lockfile, satisfying the reproducible-install requirement that was previously broken.
- The toolchain contract still proves the required runtime behavior: imported `typescript.version === "6.0.3"` and `tsc --version === "Version 7.0.2"`.

## Fix round 1
### Summary of changes
- Expanded the credential denylist in `src/server/memory/memory-policy.ts` to catch API/authentication token spellings with space, hyphen, or underscore separators, and to treat debit-card / credit-card contexts as banking-auth markers for PINs and security answers.
- Added regression coverage in `src/server/memory/memory-policy.test.ts` for the accepted bypasses (`API token`, `debit card PIN`) plus adjacent token-separator and card-auth variants.
- Exported the shared 500-character item limit from `src/server/memory/memory-contracts.ts` and enforced it again after NFKC normalization in `src/server/memory/memory-normalization.ts`, with an expansion regression test in `src/server/memory/memory-normalization.test.ts`.
- Tightened `src/server/config/load-config.test.ts` so the unknown-key case keeps an otherwise valid memory block, the sum-budget case uses individually valid values that only fail the cross-field refinement, and the memory-vs-chat case uses a reduced chat budget with otherwise valid memory values.

### RED evidence
```bash
pnpm vitest run src/server/config/load-config.test.ts src/server/memory/memory-normalization.test.ts src/server/memory/memory-policy.test.ts
```
- Result before production fixes: `Test Files 2 failed | 1 passed (3)` and `Tests 9 failed | 40 passed (49)`.
- Exact failures:
  - `src/server/memory/memory-policy.test.ts`: 8 failures (`api tokens`, `hyphenated api tokens`, `underscored api tokens`, `auth tokens`, `authentication tokens`, `debit card PINs`, `credit card PINs`, `credit card security answers`).
  - `src/server/memory/memory-normalization.test.ts`: 1 failure (`rejects normalized content that expands beyond the 500-character item limit`).
- Note on the config-test finding: the new `load-config` cases are test-only precision fixes, so they passed immediately against the already-correct schema/runtime behavior while closing the three false-positive gaps identified in review.

### Final verification
```bash
pnpm vitest run src/server/config/load-config.test.ts src/server/memory/memory-contracts.test.ts src/server/memory/memory-normalization.test.ts src/server/memory/memory-policy.test.ts
```
- Result: `Test Files 4 passed (4)` and `Tests 61 passed (61)`.

```bash
pnpm typecheck
```
- Result: `next typegen` completed and `tsc --noEmit` exited successfully.

```bash
pnpm lint
```
- Result: `0 errors, 9 warnings`.
- Warning count unchanged; all 9 warnings remain outside Task 1 scope in pre-existing files under `src/app/admin`, `src/components/characters`, and `src/server/chat/token-counter.ts`.

### Exact command/output counts
- RED focused regression run: 1 command, 3 files executed, `9 failed | 40 passed | 49 total`.
- GREEN focused Task 1 suite: 1 command, 4 files executed, `61 passed | 61 total`.
- Static verification: 2 commands, `pnpm typecheck` success and `pnpm lint` reporting `0 errors | 9 warnings`.

### Self-review
- The privacy hole is closed at the policy boundary with phrase-based coverage that no longer depends on provider-specific token formats or the old `bank`/`banking` wording.
- The size invariant is now enforced on the normalized content that would actually be persisted, without mutating or rejecting otherwise valid raw provider content before normalization.
- The config test fixes are surgical and improve failure specificity without changing production behavior or broadening the task scope.

### Commit
- New commit created after this report update with the required `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>` trailer; the exact hash is provided in the final handoff because this report file cannot self-reference its own containing commit hash.
