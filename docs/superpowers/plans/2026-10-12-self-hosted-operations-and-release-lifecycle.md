# Self-Hosted Operations and Release Lifecycle Implementation Plan

> **For Copilot:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Ship a reproducible `0.2.0` self-hosted release with one production image, encrypted streaming backups, verified empty-target restores, safe upgrade checks, privacy-preserving observability, and an automated release drill from a populated Phase 4 database.

**Architecture:** Keep the modular monolith and PostgreSQL as the only required stateful dependency. Add an operations CLI beside the app and worker entrypoints, generate one immutable release manifest at build time, coordinate app/worker/operations through PostgreSQL advisory locks, stream logical dumps through a strict ZIP container and `age`, and expose bounded structured logs and metrics from the existing app process plus a new worker-local observability listener.

**Tech Stack:** Node.js 24, TypeScript, Next.js 16, PostgreSQL 16, Drizzle migrations, `pg_dump`/`pg_restore`, `age`, `fflate`, `prom-client`, Vitest, Playwright, Docker Compose, CycloneDX, and Trivy.

**Spec:** `docs/superpowers/specs/2026-10-12-self-hosted-operations-and-release-lifecycle-design.md`

---

## Global Constraints

- Use TDD for every behavior change: add the named failing test first, run it and observe the intended failure, implement only enough to pass, then rerun the focused test.
- Never write an unencrypted database dump, decrypted archive, private key, database password, provider secret, SMTP secret, authentication secret, user identifier, email address, message content, memory content, or arbitrary error text to disk or logs.
- PostgreSQL remains the only required stateful service. `age`, PostgreSQL client tools, and release scanners are executable dependencies packaged in or invoked around the single production image.
- The app, worker, migration process, and operations CLI use the same generated release manifest. Runtime code must not infer release identity from `package.json`.
- Backups may run while app and worker hold shared lifecycle locks. Restore and migration require the exclusive lifecycle lock and fail before mutation when another process is active.
- Restore supports only an empty target database. It never drops, cleans, truncates, overwrites, or automatically rolls back an existing database.
- All archive readers use an exact entry allowlist, reject duplicate entries, enforce compressed and uncompressed byte limits, verify SHA-256 digests, and reject trailing or malformed data.
- `upgrade-check` and `verify` are read-only. They must not create schemas, acquire destructive locks, rewrite config, or consume an archive in a way that prevents the subsequent approved operation.
- Public configuration may be included in backups. Environment variables and secret configuration must never be included.
- Metrics default to disabled. A non-loopback metrics listener requires a dedicated bearer secret distinct from all application secrets.
- Do not edit historical migration SQL. New schema work starts at the next migration after `0022_admin_dead_letter_retry`.
- Preserve the existing Phase 3 migration fixture, Phase 4 privacy invariants, export/delete behavior, and Node 24 release gate.
- Every implementation commit includes:

  `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`

## Review Focus

Each focus has an owning task and an explicit release-gate assertion:

1. **Destructive-boundary safety — Tasks 2, 6, and 7:** active-process locking, empty-target enforcement, preflight-before-mutation, and single-transaction restore/migration behavior.
2. **Backup confidentiality and integrity — Tasks 3, 4, and 5:** no plaintext artifacts, strict archive parsing, recipient encryption, tamper detection, bounded input, and atomic output.
3. **Release and schema compatibility — Tasks 1 and 7:** immutable manifest, exact migration hashes, supported source range, app/worker identity agreement, and read-only upgrade checks.
4. **Observability privacy and access control — Tasks 8 and 9:** safe-field logging, bounded metric labels, default-off endpoints, bearer protection, and sentinel scanning.
5. **Reproducibility and supply-chain evidence — Tasks 10 and 11:** one image, packaged tools, SBOM, image digest/checksums, vulnerability/secret scans, and a real Phase 4 backup/upgrade/restore drill.

## Task Order

Execute Tasks 1–11 in order. Tasks 3 and 8 are internally independent after Task 2, but keep the documented order so archive error reporting is built on the operations result contract. Do not start a later task while an earlier task has failing focused tests or unresolved review findings.

### Task 1: Generate and enforce the immutable release manifest

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `.gitignore`
- Create: `src/server/release/release-manifest.ts`
- Create: `scripts/generate-release-manifest.ts`
- Create: `src/test/release-manifest.test.ts`
- Create at build time only: `.release/release-manifest.json`

**Interfaces:**

```ts
export const RELEASE_MANIFEST_FORMAT = 1;

export interface ReleaseMigration {
  id: string;
  createdAt: number;
  sha256: string;
}

export interface ReleaseManifest {
  formatVersion: 1;
  app: {
    version: string;
    gitRevision: string;
    builtAt: string;
  };
  backup: {
    writableFormat: 1;
    readableFormats: readonly [1];
  };
  database: {
    postgresMajors: readonly [16];
    minimumSourceAppRange: ">=0.1.0 <0.2.0";
    minimumSourceMigration: "0022_admin_dead_letter_retry";
    targetMigration: string;
    migrations: readonly ReleaseMigration[];
  };
}

export function parseReleaseManifest(value: unknown): ReleaseManifest;
export function loadReleaseManifest(path?: string): Promise<ReleaseManifest>;
export function currentReleaseManifest(): Promise<ReleaseManifest>;
```

`generate-release-manifest.ts` accepts `--output`, `--git-revision`, and optional `--built-at`. It reads the exact package version and Drizzle journal, hashes every referenced SQL file, validates SemVer with `semver@7.8.5`, writes canonical JSON through a temporary sibling file, and atomically renames it.

**Steps:**

- [ ] Add `semver@7.8.5` and `@types/semver@7.8.0`; change the package version to `0.2.0`.
- [ ] Add tests that reject missing fields, additional fields, invalid SemVer, invalid timestamps, duplicate migration IDs, non-hex digests, unsupported PostgreSQL majors, non-contiguous journal order, and a target migration that does not equal the final migration.
- [ ] Add a deterministic-generation test using a fixed revision and timestamp. Assert byte-for-byte stable JSON and SHA-256 values matching every file in `drizzle/meta/_journal.json`.
- [ ] Run `pnpm exec vitest run src/test/release-manifest.test.ts` and confirm the module-not-found failure.
- [ ] Implement strict parsing and immutable return values in `release-manifest.ts`. Do not fall back to `package.json`, environment variables, or a synthetic development manifest when the file is absent.
- [ ] Implement the generator, add `"release:manifest": "tsx scripts/generate-release-manifest.ts"` to `package.json`, and ignore `.release/`.
- [ ] Run `pnpm release:manifest -- --output .release/release-manifest.json --git-revision test-revision --built-at 2026-10-12T00:00:00.000Z`.
- [ ] Run `pnpm exec vitest run src/test/release-manifest.test.ts` and `pnpm typecheck`.
- [ ] Commit:

  ```bash
  git add package.json pnpm-lock.yaml .gitignore src/server/release/release-manifest.ts scripts/generate-release-manifest.ts src/test/release-manifest.test.ts
  git commit -m "feat(release): generate immutable release manifests" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
  ```

**Review focus:** Confirm the runtime loader has no success-shaped fallback and the generated migration list covers every journal entry in order.

### Task 2: Add the operations command contract, configuration, lifecycle locks, and doctor

**Files:**

- Modify: `app.config.yml`
- Modify: `src/server/config/schema.ts`
- Modify: `src/server/config/runtime-config-core.ts`
- Modify: `src/server/start.ts`
- Modify: `src/worker.ts`
- Modify: `package.json`
- Create: `src/operations.ts`
- Create: `src/server/operations/command.ts`
- Create: `src/server/operations/result.ts`
- Create: `src/server/operations/tool-runner.ts`
- Create: `src/server/operations/lifecycle-lock.ts`
- Create: `src/server/operations/database-connection.ts`
- Create: `src/server/operations/doctor.ts`
- Create: `src/server/operations/__tests__/command.test.ts`
- Create: `src/server/operations/__tests__/tool-runner.test.ts`
- Create: `src/server/operations/__tests__/lifecycle-lock.integration.test.ts`
- Create: `src/server/operations/__tests__/doctor.integration.test.ts`
- Modify: `src/server/config/load-config.test.ts`

**Interfaces:**

```ts
export type OperationsCommand =
  | { name: "doctor"; json: boolean; metricsOutput?: string }
  | { name: "backup"; args: BackupArguments }
  | { name: "verify"; args: VerifyArguments }
  | { name: "restore"; args: RestoreArguments }
  | { name: "upgrade-check"; args: UpgradeCheckArguments };

export interface CommonOperationsArguments {
  metricsOutput?: string;
}

export interface BackupArguments extends CommonOperationsArguments {
  recipients: readonly string[];
  output: { kind: "file"; path: string; overwrite: boolean } | { kind: "stdout" };
}

export type EncryptedInput =
  | { kind: "file"; path: string }
  | { kind: "stdin" };

export interface VerifyArguments extends CommonOperationsArguments {
  input: EncryptedInput;
  identities: readonly string[];
}

export interface RestoreArguments extends VerifyArguments {
  publicConfigOutput: string;
}

export interface UpgradeCheckArguments extends VerifyArguments {}

export interface OperationsResult {
  ok: boolean;
  command: OperationsCommand["name"];
  code: string;
  message: string;
  details?: Readonly<Record<string, string | number | boolean>>;
}

export interface ToolInvocation {
  executable: string;
  args: readonly string[];
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
  env: Readonly<Record<string, string>>;
  stderrLimitBytes: number;
  signal?: AbortSignal;
}

export const LIFECYCLE_ADVISORY_LOCK_ID = "4827858800559854897";
export function acquireLifecycleLock(
  mode: "shared" | "exclusive",
  options: { wait: boolean; signal?: AbortSignal },
): Promise<{ release(): Promise<void> }>;
```

Add strict public configuration:

```yaml
operations:
  max_restore_bytes: 68719476736
  command_timeout_seconds: 3600
observability:
  log_level: info
  metrics:
    enabled: false
    worker_host: 127.0.0.1
    worker_port: 9465
```

Add one secret environment variable, `METRICS_BEARER_TOKEN`. Runtime validation requires at least 32 bytes when metrics are enabled and either the existing app HTTP listener or the worker observability listener binds a non-loopback host. Reject equality with `AUTH_SECRET`, model credentials, SMTP credentials, or database password.

**Steps:**

- [ ] Add strict config tests for defaults, unknown keys, byte and timeout bounds, loopback detection, missing non-loopback token, short token, and secret reuse.
- [ ] Add command-parser tests for help, exact flags, duplicate flags, unknown flags, missing values, mutually exclusive input/output flags, and exit-code mapping. Ensure parse errors do not echo argument values.
- [ ] Add tool-runner tests with fake executables that prove argument arrays are not shell-expanded, only the supplied environment is inherited, stderr is bounded, abort terminates the exact child process, and reported errors contain a stable code rather than raw stderr.
- [ ] Add database-connection tests proving `DATABASE_URL` is decomposed into `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, and `PGSSLMODE` without putting credentials in child arguments or results.
- [ ] Add lock integration tests: multiple shared holders succeed; an exclusive `try` fails while shared holders exist; shared `try` fails during exclusive ownership; release permits the next owner; cancellation closes the dedicated connection.
- [ ] Run the four focused test files and confirm the expected failures.
- [ ] Implement the command/result contract, safe tool runner, database environment builder, and dedicated-session advisory lock.
- [ ] Implement `doctor` checks for manifest loading, config loading, PostgreSQL connectivity/version, migration hash compatibility, and executable versions for `pg_dump`, `pg_restore`, and `age`. Return one bounded result per check.
- [ ] Add `"ops": "tsx src/operations.ts"` to `package.json`.
- [ ] Acquire one shared lifecycle lock before the app listens and before the worker starts polling. Release it during their existing graceful shutdown paths. Fail startup if the lock cannot be acquired.
- [ ] Run:

  ```bash
  pnpm exec vitest run \
    src/server/config/load-config.test.ts \
    src/server/operations/__tests__/command.test.ts \
    src/server/operations/__tests__/tool-runner.test.ts \
    src/server/operations/__tests__/lifecycle-lock.integration.test.ts \
    src/server/operations/__tests__/doctor.integration.test.ts
  pnpm typecheck
  ```

- [ ] Commit:

  ```bash
  git add app.config.yml package.json src/operations.ts src/server/config src/server/start.ts src/worker.ts src/server/operations
  git commit -m "feat(ops): add doctor and lifecycle coordination" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
  ```

**Review focus:** Verify that lock ownership uses a dedicated PostgreSQL session, every failure closes that session, and no command error can include raw command arguments, environment values, or stderr.

### Task 3: Define the strict streaming backup container

**Files:**

- Create: `src/server/operations/backup-format.ts`
- Create: `src/server/operations/backup-writer.ts`
- Create: `src/server/operations/backup-reader.ts`
- Create: `src/server/operations/checksum.ts`
- Create: `src/server/operations/__tests__/backup-format.test.ts`
- Create: `src/server/operations/__tests__/backup-streaming.test.ts`

**Interfaces:**

```ts
export const BACKUP_FORMAT_VERSION = 1;
export const BACKUP_ENTRY_NAMES = [
  "public-config.yml",
  "release-manifest.json",
  "database.dump",
  "checksums.sha256",
  "backup-manifest.json",
] as const;

export interface BackupManifest {
  formatVersion: 1;
  createdAt: string;
  producerVersion: string;
  source: {
    postgresMajor: 16;
    migrationTip: string;
    migrationCount: number;
  };
  entries: Readonly<Record<
    "public-config.yml" | "release-manifest.json" | "database.dump",
    { sha256: string; bytes: number }
  >>;
}

export interface BackupPayloads {
  publicConfig: Uint8Array;
  releaseManifest: Uint8Array;
  databaseDump: NodeJS.ReadableStream;
}

export function createBackupArchive(
  payloads: BackupPayloads,
  metadata: Omit<BackupManifest, "entries">,
): NodeJS.ReadableStream;

export function inspectBackupArchive(
  stream: NodeJS.ReadableStream,
  limits: BackupReadLimits,
): Promise<VerifiedBackupMetadata>;
```

Use ZIP only as a streaming container. Stored entries are allowed for already compressed custom-format dumps; metadata entries may use deflate. The reader accepts exactly one copy of each listed entry, requires `backup-manifest.json` to be last, rejects directories and unknown entries, and calculates digests while bytes flow.

Limits:

- public config: 1 MiB
- release manifest: 256 KiB
- checksum file: 256 KiB
- backup manifest: 256 KiB
- database dump: `operations.max_restore_bytes`
- total uncompressed bytes: database limit plus 2 MiB

**Steps:**

- [ ] Add parser tests for valid canonical metadata, invalid timestamps, additional fields, wrong format, negative/fractional sizes, invalid SHA-256, missing entries, unknown entries, duplicate entries, wrong order, path traversal names, directories, mismatched checksum file, mismatched manifest digest, truncated ZIPs, trailing bytes, oversized metadata, and database size overflow.
- [ ] Add a streaming test whose database source refuses reads until the consumer drains output. Assert the writer does not buffer the complete dump and produces no filesystem writes.
- [ ] Add a failure-propagation test where the dump stream errors midway. Assert the archive stream errors and does not emit a valid manifest.
- [ ] Run the two focused tests and confirm the module-not-found failures.
- [ ] Implement canonical UTF-8 JSON, lowercase hex SHA-256, deterministic checksum line order, strict YAML-byte preservation, `fflate` streaming ZIP production, and strict `fflate` streaming unzip inspection.
- [ ] Keep only bounded metadata in memory. Never concatenate `database.dump` into a `Buffer`.
- [ ] Run:

  ```bash
  pnpm exec vitest run \
    src/server/operations/__tests__/backup-format.test.ts \
    src/server/operations/__tests__/backup-streaming.test.ts
  pnpm typecheck
  ```

- [ ] Commit:

  ```bash
  git add src/server/operations/backup-format.ts src/server/operations/backup-writer.ts src/server/operations/backup-reader.ts src/server/operations/checksum.ts src/server/operations/__tests__/backup-format.test.ts src/server/operations/__tests__/backup-streaming.test.ts
  git commit -m "feat(ops): define streaming backup format" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
  ```

**Review focus:** Trace database bytes from input to output and confirm there is no complete-dump buffer, plaintext temporary file, unbounded metadata collection, or archive-entry ambiguity.

### Task 4: Implement recipient-encrypted backup with atomic output

**Files:**

- Create: `src/server/operations/backup.ts`
- Create: `src/server/operations/output-target.ts`
- Create: `src/server/operations/schema-inspection.ts`
- Create: `src/server/operations/__tests__/backup.test.ts`
- Create: `src/server/operations/__tests__/output-target.test.ts`
- Modify: `src/server/operations/command.ts`
- Modify: `src/operations.ts`

**Command:**

```text
pnpm ops backup --recipient age1... [--recipient age1...] (--output PATH | --stdout) [--overwrite]
```

`--output` writes ciphertext to a mode-`0600` temporary sibling, fsyncs the file, atomically renames it, and fsyncs the parent directory. Existing destinations are rejected unless `--overwrite` is explicitly present; overwrite still uses atomic replacement. `--stdout` writes ciphertext only to stdout and all machine-readable status to stderr.

**Steps:**

- [ ] Add argument tests for one or more recipients, duplicate-recipient normalization, malformed recipients, output/stdout exclusivity, overwrite behavior, and rejection of output paths equal to the public config or release manifest path.
- [ ] Add backup-service tests with fake `pg_dump` and `age` executables. Assert exact `pg_dump` flags: `--format=custom`, `--no-owner`, `--no-acl`, `--compress=0`, and no database URL in arguments.
- [ ] Assert the stream is: `pg_dump stdout -> backup archive -> age stdin -> ciphertext output`; process failures terminate the other processes and remove incomplete temporary output.
- [ ] Assert the backup holds a shared lifecycle lock, records the exact observed migration tip/count and PostgreSQL major, rejects unknown/mismatched migration hashes, and preserves the exact public config bytes.
- [ ] Add output-target tests for mode `0600`, atomic rename, fsync, destination collision, interrupted write cleanup, broken stdout propagation, and no broad deletion.
- [ ] Run the focused tests and confirm the expected failures.
- [ ] Implement schema inspection by reading `drizzle.__drizzle_migrations`, comparing every applied hash/timestamp against the release manifest, and refusing databases older than `0022_admin_dead_letter_retry`, newer than the manifest, or divergent at any position.
- [ ] Implement backup orchestration and content-free `OperationsResult` fields: encrypted byte count, archive format, source migration tip/count, producer version, and destination kind.
- [ ] Run:

  ```bash
  pnpm exec vitest run \
    src/server/operations/__tests__/backup.test.ts \
    src/server/operations/__tests__/output-target.test.ts \
    src/server/operations/__tests__/command.test.ts
  pnpm typecheck
  ```

- [ ] Commit:

  ```bash
  git add src/operations.ts src/server/operations
  git commit -m "feat(ops): create encrypted streaming backups" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
  ```

**Review focus:** Inject failure at each pipeline stage and confirm incomplete output is never published, plaintext never reaches disk, and database credentials never appear in process arguments or results.

### Task 5: Verify encrypted backups without mutation

**Files:**

- Create: `src/server/operations/encrypted-input.ts`
- Create: `src/server/operations/verify.ts`
- Create: `src/server/operations/__tests__/encrypted-input.test.ts`
- Create: `src/server/operations/__tests__/verify.test.ts`
- Modify: `src/server/operations/command.ts`
- Modify: `src/operations.ts`

**Command:**

```text
pnpm ops verify (--input PATH | --stdin) --identity PATH [--identity PATH...]
```

For stdin, copy only ciphertext to a mode-`0600` file in an operation-owned temporary directory. Register signal cleanup before the first byte is read. Reject identity paths that are not regular files or have group/other permission bits.

**Steps:**

- [ ] Add encrypted-input tests for regular files, stdin ciphertext spooling, byte limits, signal cleanup, read errors, permission checks, symlink rejection, and cleanup limited to the exact operation-owned directory.
- [ ] Add verification tests using a real temporary `age` key pair when available and a deterministic fake otherwise. Cover valid archives, wrong identity, tampered ciphertext, truncated ciphertext, malformed ZIP, digest mismatch, unsupported backup format, unsupported PostgreSQL major, unsupported source migration, and metadata overflow.
- [ ] Assert `verify` performs no database queries, does not acquire the lifecycle lock, leaves the input untouched, removes temporary ciphertext, and returns only release/schema/checksum metadata.
- [ ] Run the two focused tests and confirm the expected failures.
- [ ] Implement decryption as `age --decrypt --identity ...` feeding the strict archive inspector. Do not include raw `age` stderr in errors.
- [ ] Add stable failure codes: `OPS_INPUT_INVALID`, `OPS_IDENTITY_INVALID`, `OPS_DECRYPT_FAILED`, `OPS_ARCHIVE_INVALID`, `OPS_CHECKSUM_MISMATCH`, and `OPS_BACKUP_UNSUPPORTED`.
- [ ] Run:

  ```bash
  pnpm exec vitest run \
    src/server/operations/__tests__/encrypted-input.test.ts \
    src/server/operations/__tests__/verify.test.ts \
    src/server/operations/__tests__/backup-format.test.ts
  pnpm typecheck
  ```

- [ ] Commit:

  ```bash
  git add src/operations.ts src/server/operations
  git commit -m "feat(ops): verify encrypted backups" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
  ```

**Review focus:** Confirm every verification path is read-only, all ciphertext temp files are private and cleaned, and no decrypted byte is written to a file.

### Task 6: Restore only into an empty database

**Files:**

- Create: `src/server/operations/restore.ts`
- Create: `src/server/operations/restore-database.ts`
- Create: `src/server/operations/public-config-output.ts`
- Create: `src/server/operations/__tests__/restore.integration.test.ts`
- Create: `src/server/operations/__tests__/public-config-output.test.ts`
- Modify: `src/server/operations/backup-reader.ts`
- Modify: `src/server/operations/command.ts`
- Modify: `src/operations.ts`

**Command:**

```text
pnpm ops restore \
  (--input PATH | --stdin) \
  --identity PATH \
  --public-config-output PATH
```

Restore performs two independent decrypt passes over the same ciphertext:

1. Full verification and compatibility preflight.
2. Streaming extraction of only `database.dump` into `pg_restore`.

The public config is written only after database restore, forward migration, and invariant checks succeed. It uses the same private atomic-output primitive and rejects an existing path.

**Steps:**

- [ ] Add integration tests with isolated databases for: empty target success; non-empty target rejection; active shared app/worker lock rejection; invalid archive; wrong identity; divergent migration hash; unsupported source migration; `pg_restore` failure; forward migration failure; invariant failure; and public-config destination collision.
- [ ] For every preflight failure, assert the target remains empty and the public config is absent.
- [ ] Assert `pg_restore --single-transaction --exit-on-error --no-owner --no-acl` leaves an empty target on import failure. If a later forward migration fails, assert the target remains a complete, internally valid source-version snapshot rather than a partially migrated schema; public config remains absent and the operator is told to recreate the empty target before retrying.
- [ ] Add tests that empty-target detection rejects any user table, view, materialized view, sequence, function, custom type, or existing Drizzle migration schema while ignoring PostgreSQL system schemas.
- [ ] Add a success test proving messages, memories, summaries, jobs, aggregate admin data, deletion state, and deployment settings survive exactly; secrets are supplied separately and are not restored.
- [ ] Run the focused tests and confirm the expected failures.
- [ ] Implement full verification before opening a target transaction or acquiring the exclusive lock.
- [ ] Acquire the exclusive lifecycle lock with `wait: false`, recheck target emptiness after lock acquisition, perform the second decrypt, stream only the database entry to `pg_restore`, then run supported forward migrations and post-restore invariants.
- [ ] Post-restore invariants must cover migration hashes, foreign-key validation, invalid indexes, required singleton config rows, pending job queue readability, memory provenance constraints, and absence of auth users already finalized by Phase 4 purge.
- [ ] Never issue `DROP`, `TRUNCATE`, `--clean`, `--if-exists`, or database recreation commands.
- [ ] Run:

  ```bash
  pnpm exec vitest run \
    src/server/operations/__tests__/restore.integration.test.ts \
    src/server/operations/__tests__/public-config-output.test.ts \
    src/server/operations/__tests__/verify.test.ts
  pnpm typecheck
  ```

- [ ] Commit:

  ```bash
  git add src/operations.ts src/server/operations
  git commit -m "feat(ops): restore verified backups safely" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
  ```

**Review focus:** Review SQL and process flags line-by-line. Prove every mutation occurs only after full verification, under exclusive ownership, against a rechecked empty target, and inside transaction boundaries.

### Task 7: Gate upgrades, serialize migrations, and enforce app/worker release identity

**Files:**

- Modify: `src/server/db/system-schema.ts`
- Modify: `src/server/health/worker-heartbeat.ts`
- Modify: `src/server/health/check-worker.ts`
- Modify: `src/app/api/health/ready/route.ts`
- Modify: `src/server/db/migrate.ts`
- Modify: `src/server/db/seed-characters.ts`
- Modify: `src/server/db/seed-chat-settings.ts`
- Modify: `src/server/db/seed-memory-settings.ts`
- Modify: `package.json`
- Create: `src/server/db/deploy.ts`
- Create: `src/server/operations/upgrade-check.ts`
- Create: `src/server/operations/__tests__/upgrade-check.integration.test.ts`
- Create: `src/test/release-identity-readiness.test.ts`
- Create: `src/test/db-deploy.integration.test.ts`
- Create through Drizzle: `drizzle/0023_<generated_name>.sql`
- Modify through Drizzle: `drizzle/meta/_journal.json`
- Create through Drizzle: `drizzle/meta/0023_snapshot.json`
- Modify: `tests/release/database-gate.ts`
- Modify: `src/server/operations/command.ts`
- Modify: `src/operations.ts`

**Command:**

```text
pnpm ops upgrade-check \
  (--input PATH | --stdin) \
  --identity PATH
```

`upgrade-check` verifies the backup and current live database independently, checks the release-manifest source range and exact migration prefix, confirms the target PostgreSQL major, and proves that the backup source matches the live database migration tip. It performs no writes.

**Schema change:**

Add non-null `release_version`, `release_revision`, and `release_manifest_sha256` columns to the worker heartbeat row. Backfill the singleton heartbeat with `0.1.0`, `phase4-unknown`, and 64 zeroes only inside the migration; the first Phase 5 worker heartbeat must replace them.

**Steps:**

- [ ] Add `upgrade-check` tests for supported Phase 4 source, missing verified backup, backup/live migration mismatch, divergent hash, unsupported old source, future source, PostgreSQL major mismatch, dirty target migrations, active migration lock, and read-only behavior.
- [ ] Add readiness tests proving an app returns not-ready when a fresh worker heartbeat has a different version, revision, or manifest digest; stale heartbeat remains the existing stale-worker failure; matching identity returns ready.
- [ ] Add migration tests proving app/worker shared locks block deployment, deployment holds one exclusive lock across migrations and seeds, migration failure rolls back, seeds remain idempotent, and historical SQL files are unchanged.
- [ ] Run focused tests and confirm the expected failures.
- [ ] Generate migration `0023` with the repository Drizzle command. Inspect the generated SQL and snapshot; do not rename or hand-edit historical migrations.
- [ ] Extend worker heartbeat writes with the loaded immutable release identity and readiness checks with constant-time digest comparison.
- [ ] Move `db:deploy` to `src/server/db/deploy.ts`, acquire the exclusive lifecycle lock before migration, retain it through seeds and post-deploy hash checks, and update the package script.
- [ ] Implement the read-only `upgrade-check` command. It must call the same archive verification and schema-inspection modules used by backup/restore.
- [ ] Update `database-gate.ts` so fresh and Phase 3 upgrade catalogs still match and migration hashes include `0023`.
- [ ] Run:

  ```bash
  pnpm exec vitest run \
    src/server/operations/__tests__/upgrade-check.integration.test.ts \
    src/test/release-identity-readiness.test.ts \
    src/test/db-deploy.integration.test.ts
  pnpm exec tsx tests/release/database-gate.ts
  pnpm typecheck
  ```

- [ ] Commit:

  ```bash
  git add package.json src/operations.ts src/server/db src/server/health src/app/api/health/ready src/server/operations drizzle tests/release/database-gate.ts src/test/release-identity-readiness.test.ts
  git commit -m "feat(release): gate upgrades and runtime identity" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
  ```

**Review focus:** Confirm `upgrade-check` is query-only, migration owns the exclusive lock across all mutation, and app readiness cannot accept a fresh worker from a different image.

### Task 8: Replace entrypoint logging with a privacy-safe structured logger

**Files:**

- Modify: `src/server/logging/safe-error.ts`
- Create: `src/server/logging/safe-logger.ts`
- Create: `src/server/logging/event-schema.ts`
- Create: `src/server/logging/__tests__/safe-logger.test.ts`
- Create: `src/server/logging/__tests__/event-schema.test.ts`
- Modify: `src/server/start.ts`
- Modify: `src/worker.ts`
- Modify: `src/operations.ts`
- Modify: `src/server/db/deploy.ts`
- Modify: `src/server/db/migrate.ts`
- Modify: `src/server/db/seed-characters.ts`
- Modify: `src/server/db/seed-chat-settings.ts`
- Modify: `src/server/db/seed-memory-settings.ts`

**Interfaces:**

```ts
export type SafeLogLevel = "debug" | "info" | "warn" | "error";

export interface SafeLogEvent {
  timestamp: string;
  level: SafeLogLevel;
  service: "app" | "worker" | "operations" | "migration";
  event: SafeEventName;
  releaseVersion: string;
  releaseRevision: string;
  outcome?: "started" | "succeeded" | "failed";
  durationMs?: number;
  errorCode?: string;
  command?: OperationsCommand["name"];
  counts?: Readonly<Partial<Record<SafeCountName, number>>>;
}

export function createSafeLogger(options: SafeLoggerOptions): SafeLogger;
```

The logger accepts an allowlisted event object, not arbitrary fields or child objects. Errors are converted only through stable internal codes. Timestamps and numeric durations are generated centrally.

**Steps:**

- [ ] Add compile-time and runtime tests rejecting arbitrary field names, nested free-form data, strings in `counts`, non-finite numbers, user/email/message/memory/provider fields, raw `Error`, stack traces, request URLs, headers, command arguments, and environment maps.
- [ ] Add sentinel tests for provider key, provider endpoint, email, user ID, message, memory content, database password, SMTP password, auth secret, metrics token, filesystem identity path, and raw subprocess stderr.
- [ ] Add output tests for one JSON object per line, UTC timestamp, stable field order, configured minimum level, stdout for debug/info, stderr for warn/error, and logging-stream failure behavior.
- [ ] Run focused tests and confirm the expected failures.
- [ ] Implement event schemas for process lifecycle, health listener lifecycle, job counts, operations lifecycle, migration lifecycle, and bounded failure codes.
- [ ] Replace direct `console.*` at app, worker, operations, migration, and seed entrypoints. Keep user-facing CLI output separate from diagnostic logs and content-free.
- [ ] Add a regression test proving `backup --stdout` sends only ciphertext to stdout; structured logs, progress, and failure results must use stderr for that invocation.
- [ ] Add operation correlation IDs generated internally as random 128-bit hex values; do not accept externally supplied correlation strings.
- [ ] Run:

  ```bash
  pnpm exec vitest run \
    src/server/logging/__tests__/safe-logger.test.ts \
    src/server/logging/__tests__/event-schema.test.ts \
    src/server/operations/__tests__
  pnpm typecheck
  ```

- [ ] Commit:

  ```bash
  git add src/server/logging src/server/start.ts src/worker.ts src/operations.ts src/server/db/deploy.ts src/server/db/migrate.ts src/server/db/seed-characters.ts src/server/db/seed-chat-settings.ts src/server/db/seed-memory-settings.ts
  git commit -m "feat(observability): add privacy-safe structured logs" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
  ```

**Review focus:** Search every changed entrypoint for direct console logging and verify the logger API makes privacy-unsafe fields unrepresentable rather than relying on redaction.

### Task 9: Add bounded metrics and the worker observability listener

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `src/server/observability/metrics.ts`
- Create: `src/server/observability/metrics-auth.ts`
- Create: `src/server/observability/operational-metrics.ts`
- Create: `src/server/observability/http-listener.ts`
- Create: `src/server/observability/textfile.ts`
- Create: `src/server/observability/__tests__/metrics.test.ts`
- Create: `src/server/observability/__tests__/metrics-auth.test.ts`
- Create: `src/server/observability/__tests__/http-listener.integration.test.ts`
- Create: `src/server/observability/__tests__/textfile.test.ts`
- Modify: `src/server/start.ts`
- Modify: `src/worker.ts`
- Modify: `src/server/jobs/boss.ts`
- Modify: `src/server/operations/command.ts`
- Modify: `src/operations.ts`

**Metrics:**

Use `prom-client@15.1.3` with one registry per process. Allowed labels are fixed enums only:

- `service`: `app | worker | operations`
- `outcome`: `success | failure`
- `job_type`: values from the static queue-name union
- `command`: `doctor | backup | verify | restore | upgrade_check`
- `error_code`: values from the static operations error-code union

No route, URL, status text, user, tenant, email, character, provider, model, queue payload, exception, or arbitrary string labels.

**Endpoints:**

- App: `/metrics` is handled on the existing app HTTP listener; existing `/api/health/live` and `/api/health/ready` behavior is preserved.
- Worker: `/live`, `/ready`, and `/metrics` use the configured worker-local observability listener.
- Metrics disabled: `/metrics` returns 404; app health routes and worker `/live` and `/ready` remain available.
- Non-loopback: `/metrics` requires `Authorization: Bearer <METRICS_BEARER_TOKEN>`; health endpoints never reveal exception text or configuration.

**Steps:**

- [ ] Add the pinned dependency and registry tests for names, types, help text, fixed labels, rejection of unknown labels, no default process metrics, and reset isolation between tests.
- [ ] Add metrics covering build/version info, process start time, readiness, worker heartbeat age, request count and latency by a static route-class enum, queue depth/claim age/processing/retry/failure/dead-letter by static workload type, aggregate chat/background token usage, database pool utilization, email queue success/failure, operations duration/result totals, and last successful backup timestamp.
- [ ] Add auth tests for loopback/no-token, non-loopback/missing token config rejection, absent/malformed/wrong bearer headers, constant-time comparison, and no token reflection.
- [ ] Add listener integration tests for disabled metrics, correct content type, GET-only behavior, body-size zero for health requests, graceful close, port collision failure, readiness identity mismatch, and no Next.js dependency in the worker.
- [ ] Add textfile tests for the optional `--metrics-output PATH` flag on every operations command: atomic mode-`0600` write, OpenMetrics parseability, fixed labels only, destination collision, one invocation result only, and no database content.
- [ ] Run focused tests and confirm the expected failures.
- [ ] Implement the app metrics handler in the existing custom HTTP boundary and shared worker-listener code with injected live/ready callbacks. Start the worker listener only after release manifest/config loading and close it in graceful shutdown.
- [ ] Query queue/heartbeat aggregates with bounded statements; never load job payloads. Cache operational gauges for at most 10 seconds and expose query failures as readiness/metric error codes rather than zero-shaped success.
- [ ] Instrument job completion and operations commands at fixed call sites.
- [ ] Run:

  ```bash
  pnpm exec vitest run \
    src/server/observability/__tests__ \
    src/server/logging/__tests__ \
    src/server/config/load-config.test.ts
  pnpm typecheck
  ```

- [ ] Commit:

  ```bash
  git add package.json pnpm-lock.yaml src/server/observability src/server/start.ts src/worker.ts src/server/jobs/boss.ts src/server/operations src/operations.ts
  git commit -m "feat(observability): expose safe app and worker metrics" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
  ```

**Review focus:** Enumerate every metric label value and prove cardinality is statically bounded. Verify non-loopback endpoints cannot start without the dedicated secret and no endpoint leaks config or readiness exception text.

### Task 10: Package operations and supply-chain evidence in the production image

**Files:**

- Modify: `Dockerfile`
- Modify: `docker-compose.yml`
- Modify: `scripts/docker-entrypoint.sh`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `scripts/release/build-artifacts.ts`
- Create: `scripts/release/run-trivy.ts`
- Create: `scripts/release/check-artifacts.ts`
- Create: `src/test/release-artifacts.test.ts`
- Modify: `src/test/deployment-config.test.ts`
- Create at release time only: `dist/release/`

**Image contract:**

- Base/runtime Node remains major 24.
- Install PostgreSQL 16 client tools and `age` in the final Alpine image.
- Generate `.release/release-manifest.json` in the build stage from explicit `GIT_REVISION` and `BUILD_TIMESTAMP` arguments.
- Copy the same manifest and operations code into the final image.
- Run app, worker, migration, doctor, backup, verify, restore, and upgrade-check through the same entrypoint and image.

**Release artifacts:**

`pnpm release:artifacts -- --image custard-bun:0.2.0 --output dist/release` produces:

- `custard-bun-0.2.0-source.tar.gz`
- `release-manifest.json`
- `sbom.cdx.json`
- `image-digest.txt`
- `dependency-scan.json`
- `container-scan.json`
- `secret-scan.json`
- `misconfiguration-scan.json`
- `checksums.sha256`
- `scan-summary.json`

Use `@cyclonedx/cyclonedx-npm@6.0.1`. Run Trivy `v0.75.0` through its official container for dependency, image, misconfiguration, and secret scans. Fail on `CRITICAL` or `HIGH` vulnerabilities, any detected secret, malformed reports, or an unpinned production dependency.

**Steps:**

- [ ] Add source-contract tests proving the final image installs `pg_dump`, `pg_restore`, and `age`; contains the generated manifest; has no build toolchain or test fixtures; uses one non-root runtime user; and exposes no secret as `ARG`, `ENV`, or layer command.
- [ ] Add Compose-contract tests proving app, worker, migrate, and the `ops` profile share one exact image reference; operations mounts a dedicated backup directory; no service embeds secrets; worker health uses its HTTP readiness listener; and metrics ports bind loopback by default.
- [ ] Add artifact tests for a clean `git archive` source tarball, canonical manifest equality, CycloneDX shape, image digest format, machine-readable scan reports, sorted checksum lines, checksum self-verification, bounded scan summary, and rejection of missing/extra artifacts.
- [ ] Run focused tests and confirm the expected failures.
- [ ] Modify the Dockerfile and entrypoint. Validate packaged versions during image build with `node --version`, `pg_dump --version`, `pg_restore --version`, and `age --version`.
- [ ] Add an `ops` Compose profile with no automatic restart and no published non-loopback port. Document commands through Compose labels or comments only where existing file style permits.
- [ ] Implement artifact generation with argument arrays, operation-owned temporary directories, atomic publication of the completed artifact directory, and no raw scanner output in `scan-summary.json`.
- [ ] Add scripts:

  ```json
  {
    "release:artifacts": "tsx scripts/release/build-artifacts.ts",
    "release:artifacts:check": "tsx scripts/release/check-artifacts.ts"
  }
  ```

- [ ] Run:

  ```bash
  pnpm exec vitest run src/test/deployment-config.test.ts src/test/release-artifacts.test.ts
  docker build \
    --build-arg GIT_REVISION="$(git rev-parse HEAD)" \
    --build-arg BUILD_TIMESTAMP="2026-10-12T00:00:00.000Z" \
    -t custard-bun:0.2.0 .
  docker run --rm custard-bun:0.2.0 pnpm ops doctor --help
  docker run --rm custard-bun:0.2.0 sh -lc 'pg_dump --version && pg_restore --version && age --version'
  pnpm typecheck
  ```

- [ ] Commit:

  ```bash
  git add Dockerfile docker-compose.yml scripts/docker-entrypoint.sh scripts/release package.json pnpm-lock.yaml src/test/deployment-config.test.ts src/test/release-artifacts.test.ts
  git commit -m "build(release): package operations and supply-chain evidence" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
  ```

**Review focus:** Inspect the final image rather than only the Dockerfile. Confirm all commands use the same manifest/image, secrets are absent from layers and artifacts, and release output is complete before atomic publication.

### Task 11: Add the real Phase 4 restore drill, privacy gate, and operator documentation

**Files:**

- Create: `tests/release/fixtures/phase4.sql`
- Create: `tests/release/operations-gate.ts`
- Modify: `tests/release/compose-gate.ts`
- Modify: `tests/release/compose.release.yml`
- Modify: `tests/release/privacy-scan.ts`
- Modify: `compose.test.yml`
- Modify: `package.json`
- Modify: `README.md`
- Create: `docs/deployment/self-hosted-quickstart.md`
- Create: `docs/deployment/backup-and-restore.md`
- Create: `docs/deployment/upgrades.md`
- Create: `docs/deployment/observability.md`
- Create: `docs/deployment/release-verification.md`
- Create: `docs/deployment/examples/prometheus-alerts.yml`
- Create: `docs/deployment/examples/grafana-dashboard.json`
- Modify: `docs/superpowers/plans/2026-09-23-ai-companion-roadmap.md`
- Modify: `docs/superpowers/specs/2026-10-12-self-hosted-operations-and-release-lifecycle-design.md`

**Release drill:**

The automated gate must:

1. Create a source database from a committed populated Phase 4 fixture whose Drizzle tip is exactly `0022_admin_dead_letter_retry`.
2. Start a Phase 5 app and worker against the source database and prove they can acquire shared lifecycle locks and process one real chat/memory job without retroactive extraction.
3. Generate an ephemeral `age` key, run an encrypted backup from the production image, and verify it.
4. Run `upgrade-check` against the source and verified backup.
5. Stop app and worker, prove the exclusive migration/restore lock is now obtainable, and retain captured structured logs/metrics.
6. Restore into a newly created empty target database and write restored public config to a new path.
7. Start app and worker from the same production image against the target.
8. Run browser acceptance for login, prior conversation visibility, memory visibility, new chat, admin aggregates, export, forget/delete, and readiness identity.
9. Compare source/target durable invariants and prove secrets were supplied externally rather than restored.
10. Run the extended privacy scan and delete only the gate-owned databases, key, ciphertext, and evidence directory.

**Steps:**

- [ ] Create the Phase 4 fixture from a dedicated database deployed at migration `0022`, seed deterministic non-sensitive users/conversations/memories/summaries/jobs/admin aggregates/deletion state, remove credentials and volatile timestamps, and verify its migration hashes before committing. Inject all privacy sentinels only at runtime so they cannot enter the source release archive.
- [ ] Add operations-gate failure assertions for live-process restore refusal, non-empty target refusal, wrong identity, tampered backup, app/worker version mismatch, interrupted backup output, and cleanup after each failure.
- [ ] Extend privacy evidence surfaces to require:
  - `operations-logs`
  - `metrics`
  - `release-artifacts`
  - the existing `responses`, `decoded-exports`, `app-logs`, `worker-logs`, `admin-html`, and `static-assets`
- [ ] Add sentinels for age identity material, database password, metrics bearer token, backup destination path, user/email/content data, provider key/endpoint, and another user's data. Scan recursively and require at least one real file in every surface.
- [ ] Ensure decoded backup metadata is scanned but database content is validated through invariant queries rather than copied into the evidence directory.
- [ ] Run the new release drill and observe failures before completing orchestration:

  ```bash
  pnpm release:operations-gate
  ```

- [ ] Implement Compose orchestration with unique project/database names, bounded waits, explicit app/worker stop, and exact-resource cleanup in `finally`.
- [ ] Write quickstart documentation with exact prerequisites, image-digest verification, required secrets, first boot, doctor, health checks, and rollback policy.
- [ ] Write backup/restore documentation with key custody, recipient rotation, stdout/file examples, retention, off-host storage, restore preconditions, empty-target warning, and a quarterly drill checklist.
- [ ] Write upgrade documentation with verified backup first, `upgrade-check`, app/worker stop, migration, readiness identity, forward-only policy, and recovery by restoring to a new empty database.
- [ ] Write observability documentation with default-off metrics, loopback defaults, bearer-token requirements, safe fields, metric inventory, alert suggestions, and prohibited labels.
- [ ] Add Prometheus alert examples and a minimal Grafana dashboard for app/worker readiness, queue delay, dead-letter growth, database pool saturation, email failures, token-budget exhaustion, missing backup textfile evidence, version mismatch, and migration/restore failure. Validate that templates contain no hosted telemetry destination or user-derived label.
- [ ] Write release-verification documentation covering SBOM, image digest, checksums, scanner policy, and local reproduction.
- [ ] Add package scripts:

  ```json
  {
    "release:database-gate": "tsx tests/release/database-gate.ts",
    "release:compose-gate": "tsx tests/release/compose-gate.ts",
    "release:operations-gate": "tsx tests/release/operations-gate.ts",
    "release:privacy-scan": "tsx tests/release/privacy-scan-cli.ts"
  }
  ```

- [ ] After the focused operations drill passes, update spec status to `Implemented in 0.2.0` and roadmap Phase 5 status to `Complete`, then commit the release candidate:

  ```bash
  git add tests/release compose.test.yml package.json README.md docs/deployment docs/superpowers/plans/2026-09-23-ai-companion-roadmap.md docs/superpowers/specs/2026-10-12-self-hosted-operations-and-release-lifecycle-design.md
  git commit -m "test(release): prove self-hosted recovery lifecycle" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
  ```

- [ ] Confirm `git status --short` is empty, then run the complete release gate against that exact committed `HEAD`:

  ```bash
  corepack pnpm install --frozen-lockfile
  pnpm release:manifest -- \
    --output .release/release-manifest.json \
    --git-revision "$(git rev-parse HEAD)" \
    --built-at "2026-10-12T00:00:00.000Z"
  docker build \
    --build-arg GIT_REVISION="$(git rev-parse HEAD)" \
    --build-arg BUILD_TIMESTAMP="2026-10-12T00:00:00.000Z" \
    -t custard-bun:0.2.0 .
  pnpm test
  pnpm typecheck
  pnpm lint
  pnpm build
  pnpm release:database-gate
  pnpm release:compose-gate
  pnpm release:operations-gate
  pnpm release:privacy-scan
  pnpm release:artifacts -- --image custard-bun:0.2.0 --output dist/release
  pnpm release:artifacts:check -- --input dist/release
  ```

- [ ] Request a final code review covering all five Review Focus areas. Fix every confirmed Critical, High, or Important finding and rerun the smallest affected gate plus the complete gate.
- [ ] Commit each review fix without amending the release-candidate commit, confirm a clean working tree, regenerate the manifest/image/artifacts from the new `HEAD`, and rerun the complete gate.

**Review focus:** Treat this drill as the release criterion, not a demonstration. Confirm it uses the production image and real binaries, starts from migration `0022`, exercises encrypted backup and empty-target restore, preserves Phase 4 privacy invariants, and leaves no gate-owned resource behind.

## Plan Completion Checklist

- [ ] Every spec requirement is owned by a task and a named test or release-gate assertion.
- [ ] Every operations failure is explicit, content-free, and mapped to a stable code.
- [ ] No task introduces a plaintext dump/decrypted archive path.
- [ ] No historical migration is modified.
- [ ] No metric or log surface accepts unbounded/free-form labels or fields.
- [ ] `doctor`, `verify`, and `upgrade-check` are non-mutating.
- [ ] Restore refuses active processes and non-empty targets before mutation.
- [ ] App and worker refuse release-identity disagreement.
- [ ] One production image runs all lifecycle commands.
- [ ] The Phase 4 fixture restore drill and extended privacy scan pass.
- [ ] The complete Node 24 test, typecheck, lint, build, database, Compose, operations, privacy, and artifact gates pass.
- [ ] Final plan implementation is reviewed before branch integration.
