# Self-Hosted Operations and Release Lifecycle Design

**Date:** 2026-10-12  
**Status:** Approved design, implementation plan ready for approval
**Roadmap phase:** Phase 5  
**Depends on:** Phase 4 long-term memory, privacy, export, purge, and operational administration

## 1. Purpose

Phase 5 turns the deployable application into a product that self-hosters can
operate safely over time.

The preceding phases prove fresh deployment, application behavior, privacy
boundaries, and forward migration from a Phase 3 fixture. Phase 5 adds the
missing lifecycle around a real installation:

- identify exactly which release is running;
- determine whether an upgrade is supported before changing data;
- create portable encrypted backups without placing plaintext private data on
  disk;
- restore a backup into a clean replacement installation;
- observe app and worker health without exposing user content;
- publish reproducible release artifacts with supply-chain evidence;
- document recovery paths for failed upgrades and lost hosts.

Success is not merely that `pg_dump` can produce a file. A deployer must be able
to prove that an encrypted backup is complete, restore it into a new instance,
upgrade it through supported migrations, and recover working authentication,
chat, memory, privacy, accounting, and worker behavior.

## 2. Binding Product Decisions

### 2.1 Deployment model

- The application remains a modular monolith.
- PostgreSQL remains the only required stateful runtime dependency.
- The same production image is used for migration, app, worker, and operations
  commands.
- Kubernetes, distributed high availability, cross-region replication, and a
  hosted control plane are not part of this phase.

### 2.2 Backup ownership

- The application provides portable backup, verification, restore, doctor, and
  upgrade-check commands.
- The deployer owns scheduling, retention, and remote storage.
- The commands must work with cron, systemd timers, CI runners, `rclone`, and
  S3-compatible command-line tools through ordinary files or stdin/stdout.
- The application does not require an object-storage service or embed
  cloud-vendor backup credentials.

### 2.3 Encryption

- Backup output is encrypted with the `age` recipient model.
- Backup requires one or more public recipients.
- Restore and full verification require a matching private identity supplied
  through a file descriptor, stdin, or an explicitly named identity file.
- Passphrases, private identities, database URLs, and application secrets must
  never appear in process arguments, normal logs, metrics, or audit metadata.
- The implementation must use a pinned, established `age` implementation. It
  must not design a new encryption format.

### 2.4 Secret handling

The backup contains application data and is therefore private even when the
database has application-level redaction.

The backup must not contain deployment secrets that are needed to operate a
different installation:

- Better Auth signing secrets;
- deletion-token signing secrets;
- SMTP credentials;
- model API keys;
- metrics bearer tokens;
- database credentials;
- age private identities;
- reverse-proxy private keys.

Public runtime configuration may be included so that branding and policy can be
reconstructed, but secret-valued environment configuration must be supplied
again at restore time.

### 2.5 Restore target

- Restore is allowed only into an empty target database.
- App and worker processes must be stopped for restore.
- Restore never overwrites or merges into a running installation.
- Restore uses a single transaction for the logical database import.
- After import, only supported forward migrations may run.
- Automatic downgrade and destructive rollback are excluded.

### 2.6 Failure policy

- No command returns success after a partial backup, failed verification,
  failed restore, or failed migration.
- Incomplete output files are removed when the command owns the destination.
- Stream failures return a nonzero exit status and cannot emit a success-shaped
  final record.
- Upgrade failure preserves the original database and the operator's backup.
- Recovery instructions must be explicit; the system does not attempt an
  unverified automatic rollback.

## 3. Scope

### 3.1 Included

- application release manifest and version reporting;
- backup, verify, restore, doctor, and upgrade-check CLI commands;
- portable compressed and `age`-encrypted backup archives;
- schema and migration compatibility checks;
- restore drills using real Phase 4 data;
- structured privacy-safe app and worker logs;
- aggregate OpenMetrics-compatible app and worker metrics;
- version, queue, backup, migration, and resource diagnostics;
- SBOM generation;
- dependency, secret, and container-image scanning;
- image digest and release checksum publication;
- installation, upgrade, backup, restore, and disaster-recovery runbooks;
- release gates for fresh install, upgrade, restore, Compose readiness, worker
  processing, and privacy scanning.

### 3.2 Excluded

- application-managed backup scheduling or retention deletion;
- native S3, Azure Blob, or Google Cloud Storage clients;
- browser-based secret or backup management;
- restoring into a nonempty database;
- point-in-time recovery orchestration;
- physical PostgreSQL replication;
- automatic downgrade;
- automatic rollback after migration failure;
- Kubernetes operators or Helm charts;
- multi-node app or worker coordination beyond the existing PostgreSQL-backed
  locking and queue semantics;
- hosted telemetry collection;
- user-facing product analytics.

## 4. Architecture

### 4.1 Release manifest

Every production build contains one immutable release manifest shared by app,
worker, migration, and operations commands.

The manifest contains:

- semantic application version;
- Git revision;
- build timestamp;
- backup format versions readable and writable by the release;
- oldest supported source application version;
- oldest supported source schema version;
- expected migration identifiers and source hashes;
- PostgreSQL major versions supported by the operations tooling;
- operations archive format version.

The manifest contains no secret or environment-specific value.

The running app and worker expose the same application version through
content-free readiness details and metrics. A deployment with mismatched app,
worker, migration, or operations image versions is unhealthy.

### 4.2 Operations CLI

The production image provides one operations entry point:

```text
pnpm ops doctor
pnpm ops backup
pnpm ops verify
pnpm ops restore
pnpm ops upgrade-check
```

Commands use the existing strict runtime configuration loader where applicable.
They share PostgreSQL URL validation, secret redaction, structured error codes,
and content-free logging helpers with the app and worker.

The command interface must support noninteractive automation. Human-readable
progress is written to stderr. A single final JSON result may be written to
stdout when requested. Private values and archive content never enter either
stream.

### 4.3 Tooling boundary

The production image pins compatible versions of:

- PostgreSQL client tools, including `pg_dump`, `pg_restore`, and `psql`;
- `age`;
- archive and checksum tooling used by the operations command.

`doctor` rejects unsupported or mismatched tooling before backup or restore.
Host execution outside the production image is supported only when the same
version requirements pass.

The operations layer invokes tools with argument arrays rather than shell
evaluation. Secrets are passed through inherited file descriptors, stdin, or
protected environment variables, never interpolated command strings.

### 4.4 Backup archive

The logical plaintext archive exists only as a stream:

```text
pg_dump custom stream
  + public configuration
  + release/schema manifest
  + entry checksums
  -> compressed archive stream
  -> age encryption
  -> file or stdout
```

The encrypted payload contains:

```text
manifest.json
database.dump
public-config.yml
checksums.sha256
restore-readme.txt
```

`manifest.json` contains:

- backup format version;
- creation time;
- source application version and Git revision;
- source PostgreSQL major version;
- migration identifiers and hashes;
- public configuration digest;
- database dump digest and byte size;
- archive entry allowlist;
- required minimum restore version;
- required maximum restore version, when applicable.

No manifest field contains user content, email addresses, database URLs, model
endpoints, credentials, or private identifiers.

### 4.5 Backup consistency

`pg_dump` provides a transactionally consistent PostgreSQL snapshot while the
app remains online. Existing application transactions determine whether a
concurrent operation appears before or after the snapshot; partially committed
chat, memory, export, or purge state cannot appear.

Backup does not pause the app or worker. It does not modify business data.
Advisory locking is limited to serializing operations metadata and preventing
multiple operations commands from claiming the same output target.

The backup command verifies:

- supported schema and migration hashes;
- successful `pg_dump` completion;
- archive entry allowlist;
- checksums before encryption completes;
- successful `age` completion;
- durable close/rename of an application-owned output file.

For file output, data is written to a sibling temporary file and atomically
renamed only after successful encryption and flush. For stdout, a broken pipe is
an error and no success result is emitted.

### 4.6 Verification

`verify` has two levels:

1. **Envelope verification** checks that a file is readable as an `age` stream
   and reports only safe envelope metadata.
2. **Full verification** decrypts through a stream, validates the entry
   allowlist, manifest compatibility, checksums, dump readability, and required
   files.

Full verification does not restore data and does not write decrypted entries to
disk. Every verification component must consume its entry through a bounded
pipe. Tooling that requires a seekable plaintext file is not accepted for this
release.

### 4.7 Restore

Restore proceeds in this order:

1. run `doctor`;
2. acquire the operations advisory lock;
3. verify app and worker are not active against the target database;
4. prove the target database is empty;
5. fully verify and decrypt the archive as a stream;
6. validate release, PostgreSQL, and schema compatibility;
7. restore `database.dump` with a single transaction;
8. run supported forward migrations;
9. run idempotent seed/config initialization;
10. validate migration hashes, schema catalog, invariant queries, and required
    singleton rows;
11. print a content-free restore result and next-start instructions.

Restore does not import secret configuration. The deployer must supply valid
current secrets before starting app or worker.

If import or migration fails, the target remains unavailable and the command
returns a typed failure. Because the target was required to be empty, the
operator can drop and recreate it before retrying.

## 5. Upgrade Lifecycle

### 5.1 Semantic versioning

- Breaking deployment, configuration, archive, or restore changes require a
  major version.
- Backward-compatible product and operations features require a minor version.
- Corrections without compatibility changes require a patch version.

Migration identifiers remain immutable after release.

### 5.2 Upgrade check

`upgrade-check` compares the running/source deployment against the target
release manifest and validates:

- source version is in the supported range;
- PostgreSQL major version is supported;
- every applied migration identifier and hash is recognized;
- no expected migration is missing from the target image;
- current configuration parses under the target release;
- required new secrets or public settings are present;
- available database and filesystem space meets a documented minimum;
- app and worker images are from the same target release;
- a named backup exists and passes full verification when an identity is
  supplied.

The command is read-only. It cannot migrate data.

### 5.3 Upgrade execution

The supported production sequence is:

1. create and fully verify a backup;
2. run `upgrade-check` with the target image;
3. stop app and worker;
4. run the migration job once;
5. start worker and wait for readiness;
6. start app and wait for readiness;
7. run post-upgrade smoke and privacy checks.

The migration job fails if another app, worker, restore, backup, or migration
operation holds an incompatible operations lock.

### 5.4 Recovery

There is no automatic downgrade.

When migration fails before commit, the existing database remains authoritative
and the old release may be restarted if its manifest still accepts that schema.
When a release cannot safely restart against the resulting schema, the operator
restores the verified pre-upgrade backup into a new empty database and points
the old deployment at it.

Every release note states whether restart of the previous version is supported
after its migrations begin.

## 6. Observability

### 6.1 Structured logs

App, worker, migration, and operations commands use the same JSON log envelope:

- timestamp;
- level;
- process role;
- application version;
- safe event name;
- request, job, or operation correlation ID;
- safe stage;
- typed error code;
- bounded numeric duration and count fields.

Normal logs must not include:

- user content;
- memory or summary content;
- email addresses;
- raw user, conversation, message, export, or archive identifiers;
- database URLs;
- provider endpoints or keys;
- SMTP recipients or credentials;
- age recipients beyond a nonreversible fingerprint;
- age identities;
- archive filenames supplied by the operator.

### 6.2 Metrics

The app exposes OpenMetrics-compatible output through its existing HTTP
listener. The current worker has a database heartbeat but no HTTP listener, so
Phase 5 adds one worker-local observability listener for live, ready, and
metrics responses.

Metrics are disabled by default. A non-loopback metrics listener requires a
dedicated bearer secret. The bearer value is never logged.

Operations commands optionally write one atomically replaced,
OpenMetrics-compatible textfile containing only the result of that invocation.
This supports Prometheus node-exporter textfile collection without making the
application responsible for backup scheduling or retention.

Allowed dimensions are fixed low-cardinality enums such as:

- process role;
- queue type;
- safe operation type;
- terminal status;
- typed failure category;
- application version.

Email, user ID, character ID, conversation ID, model endpoint, provider request
ID, operation UUID, archive path, and free-form errors are forbidden labels.

Initial metrics include:

- app and worker build/version info;
- readiness state;
- request count and latency buckets by safe route class;
- queue depth, claim age, processing duration, retry, failure, and dead-letter
  counts by workload type;
- aggregate chat and background token usage;
- database pool utilization;
- email queue success/failure;
- backup, verify, restore, and migration duration/status in the optional
  operations textfile;
- timestamp of the last successful backup command represented by that textfile.

The operations textfile is deployer-managed operational evidence, not an
application-managed backup or retention registry.

### 6.3 Alerts and dashboards

The repository provides example Prometheus alert rules and a minimal dashboard
definition for:

- app or worker not ready;
- queue delay or dead-letter growth;
- database pool saturation;
- repeated email delivery failure;
- instance token-budget exhaustion;
- backup command not observed within a deployer-selected interval;
- version mismatch between app and worker;
- migration or restore failure.

Examples contain no hosted telemetry integration.

## 7. Supply-Chain Release Artifacts

Every release produces:

- application source archive;
- production container image;
- image digest;
- SHA-256 checksum file;
- CycloneDX or SPDX SBOM;
- dependency vulnerability scan result;
- container vulnerability scan result;
- secret scan result;
- migration compatibility report;
- fresh-install, upgrade, restore, Compose, worker, and privacy-gate results;
- release notes with supported source versions and recovery behavior.

Release automation must fail on:

- critical vulnerabilities without an explicit, time-bounded repository
  exception;
- detected committed secrets;
- unpinned runtime dependencies;
- missing checksums or SBOM;
- image/manifest version mismatch;
- migration drift;
- failed restore drill;
- failed privacy scan.

Artifact signing may use the hosting platform's keyless signing support. At a
minimum, immutable digests and checksums are mandatory.

## 8. Security and Privacy

- Backup archives are treated as complete private-data exports for the entire
  instance.
- Cross-instance backup download is not exposed through the application.
- Operations commands are host/container administrative tools, not web routes.
- Decrypted backup bytes cannot enter app logs, worker logs, metrics, audit
  events, or release artifacts.
- Error messages identify an entry or stage through fixed safe names, never
  through private content.
- Archive extraction rejects absolute paths, traversal, duplicate names,
  unknown entries, links, devices, and size expansion beyond configured limits.
- Restore validates checksums before passing dump bytes to PostgreSQL tooling.
- Age identity files must have restrictive permissions; commands reject
  group/world-readable identities unless the deployer explicitly overrides the
  check with a visible warning.
- Public configuration restored from an archive is never allowed to overwrite
  secret environment variables.
- Operations advisory locks use fixed namespaces and do not accept
  operator-controlled SQL identifiers.

## 9. Configuration

Phase 5 adds validated configuration for:

- operations temporary directory;
- maximum encrypted archive bytes;
- maximum decrypted expansion bytes;
- allowed PostgreSQL client major versions;
- metrics enablement, bind address, port, and bearer secret;
- structured log format and minimum level;
- optional release artifact output directory used only by release gates.

Backup recipients and restore identities are command inputs, not long-lived
application configuration.

Defaults keep metrics disabled and require no new runtime service.

## 10. Testing and Acceptance

### 10.1 Unit and integration coverage

Tests cover:

- release manifest parsing and mismatch detection;
- safe subprocess argument construction;
- recipient and identity validation;
- streaming archive allowlists and checksum verification;
- broken pipes and partial destination cleanup;
- missing/unsupported PostgreSQL and age tools;
- operations lock ordering;
- nonempty restore target rejection;
- wrong identity, corrupt ciphertext, tampered manifest, checksum mismatch,
  unknown archive entries, traversal, decompression bounds, and truncated dump;
- migration compatibility ranges and immutable hashes;
- metrics label allowlists and cardinality guards;
- structured-log secret scanning;
- app/worker version mismatch readiness.

### 10.2 Backup and restore drill

The release gate creates a populated Phase 4 instance containing:

- verified and unverified accounts;
- active and disabled users;
- sessions and authentication credentials;
- published and historical character versions;
- pinned conversations and completed/incomplete messages;
- quotas and usage accounting;
- ordinary and explicitly authorized sensitive memories;
- relationship summary history;
- completed and expired exports;
- pending/retrying/dead-letter background work;
- a deletion-pending account and a completed purge tombstone;
- audit events.

The gate:

1. creates an age key pair;
2. creates an encrypted backup;
3. fully verifies it;
4. restores it into a new empty database;
5. runs forward migrations;
6. starts production Compose app and worker;
7. verifies sign-in, pinned chat history, memory recall, summary state, quotas,
   admin aggregates, export metadata, deletion lockout, queue recovery, and
   tombstone behavior;
8. runs the deterministic all-surface privacy scan.

### 10.3 Negative acceptance

The release gate proves fail-closed behavior for:

- wrong age identity;
- tampered ciphertext;
- modified decrypted entry;
- missing manifest;
- unknown or duplicate entry;
- nonempty target database;
- unsupported source release;
- migration hash mismatch;
- missing new required configuration;
- insufficient disk-space simulation;
- interrupted output stream;
- interrupted restore;
- app or worker running during restore;
- mismatched app and worker releases.

### 10.4 Recovery objective

The project documents a reference recovery objective rather than promising one
for all hardware:

- a deployer can choose any backup frequency through external scheduling;
- the included reference Compose dataset must restore and reach app/worker
  readiness within 30 minutes on the documented minimum host;
- no recovery point objective is claimed beyond the age of the deployer's last
  successfully verified backup.

## 11. Documentation

The repository documents:

- first installation;
- release version discovery;
- pre-upgrade checklist;
- supported upgrade ranges;
- creating and verifying encrypted backups;
- piping backups to local files, `rclone`, and S3-compatible CLIs;
- restoring to a replacement host;
- rotating application secrets after restore;
- rollback and restore decision tree;
- example cron and systemd timers;
- backup retention examples;
- Prometheus scraping and alert examples;
- privacy boundaries for logs, metrics, and release artifacts;
- how to verify image digests, checksums, and SBOMs.

Examples use placeholders and never contain working credentials.

## 12. Delivery Order

1. Release manifest and version compatibility foundation.
2. Operations CLI framework, doctor, and upgrade-check.
3. Streaming encrypted backup and verification.
4. Empty-target restore and forward migration.
5. Structured logging and metrics.
6. Supply-chain artifacts and release automation.
7. Real Phase 4 backup/restore/upgrade drill.
8. Documentation and final release gate.

Each step must leave the repository deployable and preserve the existing
privacy release gate.

## 13. Final Acceptance

Phase 5 is accepted only when an operator can:

1. start a populated supported old release;
2. create and fully verify an encrypted age backup without plaintext
   intermediate files;
3. run a target-release upgrade check;
4. upgrade the original deployment;
5. restore the same backup into a separate empty database;
6. start app and worker from the target image against the restored database;
7. verify authentication, chat, memory, exports, accounting, administration,
   queue recovery, and deletion behavior;
8. inspect privacy-safe logs and metrics;
9. verify checksums, image digest, SBOM, and scan results;
10. pass the deterministic response/log/admin/static/export privacy scan.

No acceptance step may depend on a hosted service other than the deployer's
configured model and SMTP providers already required by the product.
