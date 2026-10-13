# Custard Bun

Custard Bun is a self-hosted application for private, streamed AI companion
conversations. Phase 3 includes runtime branding, account lifecycle, official
character administration, version-pinned conversations, an OpenAI-compatible
model gateway, explicit interruption/retry states, transactional quotas, and
aggregate-only usage administration. Phase 4 now includes durable automatic
memory extraction, versioned relationship summaries, prompt recall, and
owner-scoped memory management, aggregate-only operations, browser acceptance,
and private asynchronous data exports.
Confirmed account deletion immediately locks access and queues a restartable purge.

The anonymous official character catalog is available at `/characters`, with
public detail pages at `/characters/<slug>`. Both pages show only active
characters that have a default published version, and they render fields from
that default version only.

## Prerequisites

Use either:

- Docker with Docker Compose; or
- Node.js 24.x, pnpm 12.5.1, and PostgreSQL 16.

The TypeScript toolchain intentionally uses the TypeScript 7 compiler plus the
official TypeScript 6 API compatibility package. Keep `pnpm typecheck` on
`tsc --noEmit`: the workspace `tsc` binary resolves through `@typescript/native`
to TypeScript 7.0.2, while linting, Next's compiler-API consumers, and other
tooling import the pinned `typescript` package and see the
TypeScript 6.0.3 API. The production `pnpm build` entry point runs that native
TypeScript 7 preflight via `pnpm typecheck` before `next build`.

## Configure

Copy the environment template and replace every placeholder:

```bash
cp .env.example .env
```

Edit `app.config.yml` for the public site name, description, logo, favicon,
primary color, registration policy, and public links. The Compose deployment
mounts this file at runtime, so branding changes require a service restart but
not an image rebuild.

Keep `.env` private. It contains the database, authentication, SMTP, and model
provider credentials. Configure:

- `MODEL_API_BASE_URL`: the provider's OpenAI-compatible API root, ending
  before `chat/completions` (for example `https://provider.example/v1`);
- `MODEL_API_KEY`: the server-side bearer credential; and
- `MODEL_ID`: the provider model identifier used for chat completions.

Trusted loopback or private-network HTTP model servers are supported for
self-hosting. Only configure a server you control and trust: prompts include
character instructions and the user's current/recent conversation content.
The deployer is responsible for the provider's retention, training, residency,
access-control, and privacy terms. Model values are runtime-only Compose
environment variables; they are not public build arguments or browser
configuration.

Mailpit is used only by the automated test stack and is not a production
dependency.

## Clear Daylight interface

The interface uses the Clear Daylight light theme by default and follows the
system `prefers-color-scheme` setting for its coordinated dark theme. There is
no client-only theme toggle, so the selected theme applies before hydration.
The deployer-owned `branding.primaryColor` remains the only accent input;
runtime-derived button, link, soft-surface, and focus colors preserve readable
contrast for very light, very dark, saturated, and muted accents in both
themes.

Geist Sans and Geist Mono are bundled from the pinned local package, and the
single Phosphor icon family is bundled with the application. The production UI
does not fetch remote fonts or image assets. Motion follows
`prefers-reduced-motion`; reduced-motion users receive non-spatial transitions,
and essential dialog and drawer focus behavior remains available.

`POSTGRES_PASSWORD` may contain URI delimiters such as `/`, `?`, `#`, `@`,
literal `%2F`, `$`, and spaces. Use **single quotes** in `.env`, for example
`POSTGRES_PASSWORD='replace/ ? # @ %2F $literal space'` (not a real password).
Compose interpolates `$NAME` and `${NAME}` in unquoted and double-quoted values;
single-quoted dotenv values preserve literal `$` without expansion. In Compose
YAML itself, use `$$` for a literal `$`. Do not pre-encode the raw password or
copy the illustrative password. For literal single quotes in dotenv values,
escape them with `\'`; avoid sourcing this file as shell code.
The production entrypoint constructs
and percent-encodes `DATABASE_URL` at runtime without storing a second copy of
the password.

## Deploy with Docker Compose

Build, migrate, and start PostgreSQL, the email worker, and the web app:

```bash
docker compose up --build
```

The same production image is used for the migration job, worker, and app.
It retains the pinned lockfile for runtime CLI commands and omits rebuild-only
Next caches; startup must not resolve or install a new dependency graph.
The image build invokes `pnpm build --webpack` with a build-only 1024 MiB V8 heap
and one Next build worker, avoiding unbounded native bundler memory on small
self-hosted Docker VMs. These limits do not constrain the runtime app or worker.
The ordinary host release gate still runs `pnpm build` with the default bundler.
Docker and Compose run the
native TypeScript 7 `pnpm typecheck` preflight before `next build` while Next's
own build-time compiler-API consumers still resolve the official TypeScript 6
compatibility package.

`pnpm start` runs the supported production HTTP boundary in the same process as
Next. It validates the entire runtime configuration **before listening**, then
replaces all forwarding identity headers with the actual TCP socket peer. Better
Auth reads only this server-owned identity; callers cannot choose rate-limit
keys via `X-Forwarded-For`, `Forwarded`, or the internal header. Do not bypass
this boundary with `next start`. An optional upstream proxy/NAT is treated as
one peer (shared limits); forwarded client identities are intentionally not
trusted. `pnpm dev` is development-only and must not be publicly exposed.

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

The migration job runs `pnpm db:deploy`, which applies database migrations and
then idempotently seeds the five official character packages and initial chat
settings. For local or standalone operations, run the same steps directly:

```bash
pnpm db:migrate
pnpm db:seed:characters
pnpm db:seed:chat-settings
# or all three:
pnpm db:deploy
```

Character seeding is safe to rerun. Existing official character IDs with their
expected slugs are counted as existing and are not overwritten: drafts,
published versions, default version pointers, lifecycle state, and admin state
remain unchanged. A reserved slug or stable ID collision fails explicitly and
rolls back the seed operation instead of partially creating the catalog. The
bootstrap seed does not create administrator audit events.

Official avatars live under `public/characters` and are referenced as local
paths such as `/characters/calm-listener.svg`. Compose mounts this directory
read-only into the app, worker, and migration containers. Published avatar
files are immutable operational assets: add a new file and publish a new
character version instead of overwriting a file that an existing version
references.

## Chat behavior and safety bounds

### Private data exports

The account privacy page can request an asynchronous ZIP of versioned JSON:
safe profile fields, character relationships and pinned public character metadata,
conversations/messages and attempts, memories/evidence, current and historical
summaries, relationship controls/effective chat quotas, user-facing usage, and
audit actions targeting the owner. Credentials, sessions, verification values,
provider identities, recovery candidates, operation internals, and private audit
metadata are excluded. Exports contain private product content; handle downloaded
copies securely.

Only the current authenticated owner can download an unexpired archive. ZIP
bytes live in PostgreSQL `bytea`, never on disk or in queue payloads; SHA-256 and
size are verified again at download. Downloads use `private, no-store` headers.
Expiry is exactly 24 hours after final archive publication, not worker dispatch
or snapshot start; scheduled cleanup and owner reads remove expired archive
bytes. The `memory.maxExportArchiveBytes` configuration
defaults to 262144000 bytes and can be lowered; oversized exports fail without
partial storage. An explicit failed-job retry creates a new job, preserving
terminal database invariants.

The worker registers export generation, ID-only dead letters, and minutely
expiry cleanup alongside email, extraction, and summary work. Database retry
counts/backoff and periodic reconciliation survive lost enqueue attempts and
worker restarts. Snapshot generation holds canonical global/user mutation locks
through a separate repeatable-read snapshot and archive publication; its database
pool therefore needs at least two connections. Snapshot capacity is reserved
before canonical lock waiting, with paired export checkouts serialized to avoid
pool starvation even at that minimum. The repeatable-read transaction starts
only after the owning global/user locks are held. Account confirmation invokes
`cancelDataExportsForUser` in the same transaction that marks the user pending
deletion: it cancels nonterminal jobs and physically removes completed archives.

### Account deletion and purge

`/account` requests an application-owned verification email without deleting or
hiding existing privacy controls. The one-hour, single-use token is stored only
as a SHA-256 hash; its signed, content-free request identity permits terminal
replays after the hash is erased. The email URL carries the token in a fragment,
not an access-log query string. GET displays a confirmation form; POST consumes
the token, immediately revokes sessions, settles/cancels chat and background work,
advances relationship epochs, removes export bytes, and durably records the purge
outbox. The signed-out response does not claim removal has completed.
Verification requests are limited to three per authenticated owner per hour;
rejection leaves the last valid token intact and returns only safe retry guidance.
Verification email publication holds the canonical lock through queue acceptance;
confirmation cannot race a delayed sender into recreating private token payloads.

Better Auth direct deletion, including administrator hard removal, is disabled.
Session lookups, auth mutation fences, product services, and SMTP eligibility
reject deletion-pending owners. SMTP delivery and signup publication serialize
with confirmation; successful email jobs are stripped of recipient/token data.
Impersonated sessions also require an eligible, existing impersonator, and both
session relationships are revoked on lockout and final purge. Recovery record
insertion validates the exact current owner under the canonical deletion fence;
delayed recovery against a pending or removed owner stays a uniform no-op.
Verification UPDATE keeps identifier/value immutable and checks current owners
without late settings/user locks: its already-held row lock serializes with final
purge, which removes the unchanged private identity. Active owners may refresh
expiry; rotation requires a new fenced INSERT. Pending or missing owners cannot
restore retained verification rows.
Administrator user-state and quota mutations cannot target pending accounts.

The worker dispatches the ID-only `account-purge` queue at high priority. Each
stage commits independently: settlement, exports, memory/operations,
conversations, audit de-identification, and final auth removal. The final
transaction repeats audit de-identification, removes auth dependents, completes
a content-free tombstone with `user_id = null`, then deletes the auth user before
committing. Numeric usage totals and de-identified audit event counts survive;
private content, credentials, verification data, owned rate-limit keys, and
background identities do not.
Previously published public character snapshots remain immutable.

Five failures at one stage produce an ID-only `account-purge-dead-letter`;
periodic database reconciliation survives lost dispatches or worker restarts.
Runnable dispatch has its own batch, independent of exhausted dead letters;
already-published dead letters cannot starve newer confirmed deletions.
`getAccountPurgeState` exposes only safe state and the oldest stuck purge;
`retryAccountPurge` resumes that same request/stage, including harmless completed
tombstone retries. `/admin/memory` exposes ID-only administrative retry of
eligible dead letters and aggregate queue, export, and purge status. The
administrative audit uses a fixed role label rather than an administrator's
email. Restarting an exhausted extraction or summary cycle clears settled
execution links while retaining numeric usage; unsettled reservations block
receipt recycling until accounting is resolved.
Purge dead letters do not degrade worker readiness by themselves.

Signed-in users can start one active conversation per character. The opening
message is persisted locally and does not call the provider. Each conversation
pins the immutable character version selected at creation:

- publishing or selecting a new default does not change an existing chat;
- **Start over** archives the current chat and creates a new chat using the
  current default version;
- archived history is read-only and can be deleted independently; and
- deleting an active chat removes it permanently and returns to the app home.

Deleting a conversation keeps already-formed long-term memory and its
relationship summary. Evidence retains its source count but loses transcript
references. Unapplied extraction from that conversation is cancelled, so the
deleted transcript cannot later form new memory.

Archiving a character removes it from new/public selection. Existing active
conversations remain usable, but they cannot be restarted until the character
is restored with a selected default.

Responses stream into the timeline. **Stop** retains received partial text and
marks the attempt interrupted. A browser disconnect, provider disconnect, or
incomplete stream remains visibly interrupted rather than being presented as
complete. Retry replaces the incomplete generated attempt without duplicating
the source user message. Only one generation may run for a user across all
their conversations at a time.

Partial output is checkpointed after approximately 500 ms even if the provider
stalls, or after 1 KiB of new text. Opening an affected conversation recovers an
expired generation as interrupted. Crash recovery and account deletion charge
durable partial output once using the tokenizer's 20% safety margin when provider
usage is unavailable, and release unused token reservations.

If a submission loses its response before admission is confirmed, resending the
unchanged draft reuses its request key. A terminal replay reloads the persisted
transcript rather than creating another turn; editing the draft starts a new
submission.

`app.config.yml` defines deployer safety ceilings and first-deploy defaults:

- first-token and total request timeouts;
- prompt-token budget, maximum input characters, and maximum output tokens;
- initial per-user UTC-day request/token limits;
- initial instance UTC-month request/token budgets; and
- maximum concurrent generations.

`pnpm db:deploy` stores the initial quota values idempotently. Later
administrator edits are authoritative and are not overwritten by another
deploy. Administrators can update/reset global settings at `/admin/usage` and
set a per-user daily override at `/admin/users`. A reset restores the stored
deployment defaults. User limits reset at the next UTC day; instance budgets
reset at the next UTC month. Request and token exhaustion are reported
separately for both scopes.

Administration exposes counts, token totals, outcomes, retry counts, latency,
model IDs, and provider failure categories only. It never exposes prompts,
message text, provider credentials, or raw provider bodies.

## Memory and privacy controls

**Manage memory** in the chat header opens `/app/memories/<characterId>`.
The privacy section at `/account` and `/app/memories` list only the signed-in
user's character relationships, including relationships whose transcripts
have been deleted.

- Automatic memories are visible and active immediately; edits are
  authoritative and cannot be overwritten by automatic extraction.
- **Stop recording** prevents new automatic memories and cancels pending
  extraction. **Stop using in chat** independently prevents memory and summary
  recall in future prompts. Neither switch deletes existing memory; a reply
  already started may retain its admitted prompt.
- Memory cards show text, origin, source count, and last-confirmed date—not
  evidence message text, provider identifiers, or operational payloads.
- Memories can be edited or deleted. Summary text can be edited, cleared, or
  explicitly regenerated from current memory. Credential-class content is
  rejected; sensitive manual content requires explicit intent.
- Deleting an item revokes all pre-deletion extraction admissions for that
  relationship, including unfinished replies and their retries, without
  removing retained items. It detaches the current summary from recall (even
  a user-edited summary, and even when recording is stopped); immutable
  history is preserved, never reused as prior-summary input. A new summary
  is generated only from remaining current memories. Reloading exposes the
  authoritative summary revision even while its content is absent, so fresh
  edits and clears work while pre-deletion submissions still conflict.
  Regeneration continues to require recording to be enabled.
- Deployment `maxActiveItemsPerCharacter` is enforced under relationship
  locks without silent eviction. At capacity, new direct candidates are
  discarded; inferred items retain evidence but cannot activate until a
  subsequent eligible observation finds room. Manual activation at capacity
  fails explicitly. `maxItemCharacters` applies after Unicode normalization
  to both automatic candidates and manual edits; existing active items are
  not evicted or truncated when operators lower either limit.
- Stale revisions show a conflict, preserve the draft, and refresh the
  authoritative version before the user saves again. Background refreshes do
  not silently advance the base revision of unsaved edits.
- Status is shown as **Synced**, **Processing**, **Retrying**, or **Needs retry**.
  Manual extraction retry is offered only for an eligible **Needs retry** run.
- **Forget character** requires confirmation: it removes memory, evidence,
  and summary, advances the memory epoch, and cancels old work. Conversation
  transcripts are kept. New eligible conversations/turns can form new memory
  unless recording is stopped separately.

## Characters and administration

Anonymous visitors can browse `/characters` and `/characters/<slug>`.
Only active characters with an explicitly selected default published version
are public. Unknown, archived, and not-yet-defaulted character URLs return 404.
Anonymous pages do not expose chat or historical-version selection. Signed-in
users can start or continue a conversation from an active character detail.

Sign in with the CLI-created administrator account, then use:

- `/admin`: administration home;
- `/admin/characters`: lifecycle, draft, default, and latest-version overview;
- `/admin/characters/new`: create a character with a unique, permanent slug;
- `/admin/characters/<id>`: edit, publish, select a default, archive, or restore;
- `/admin/characters/<id>/preview`: preview the **saved** draft's real catalog
  card, detail view, and structured character package;
- `/admin/users`: search ordinary users, manage quota overrides, and disable or
  restore access;
- `/admin/usage`: manage global chat settings and inspect aggregate usage;
- `/admin/memory`: inspect aggregate-only memory jobs, exports, purge stages,
  safe failure categories, and background tokens; enable/disable new memory
  processing, restore its stored deployment default, or retry eligible terminal
  operations by ID. Disabling processing does not hide existing memories:
  relationship usage controls continue to govern recall; and
- `/admin/audit`: read-only, paginated administrative history.

Unauthenticated requests redirect to sign-in; ordinary accounts receive no
administration data. The deployment CLI above is the only administrator
bootstrap/role-management path. There is no web role editor or invitation flow.
For standalone deployments, run the same CLI against the configured instance:

```bash
pnpm exec auth create-admin --config src/server/auth/auth-cli.ts \
  --email admin@example.com --name "Admin" --role admin
```

### Character version lifecycle

Each stable character has at most one mutable draft. Save the complete package
before previewing or publishing. Saving uses a draft revision: if another
administrator saves first, copy your edits, reload, and reconcile the changes
rather than overwriting them. Server refreshes never silently advance the base
revision of local edits. Validation, database, and conflict errors retain all
entered fields; only confirmed saves or publications advance that editor's
revision. Example conversations have paired user/assistant inputs with labeled
add/remove controls, bounded to one through six pairs.

Publishing validates the content and the avatar's availability, rejects an
unchanged package, and appends an immutable numbered snapshot. It retains the
draft as the base for further editing. **Publishing never selects the default.**
Use the version-history controls to explicitly choose a published version.
Public reads then use that version; older snapshots remain loadable by ID.
The Phase 3 integration contracts are `resolveDefaultCharacterVersion` for a
new conversation and `getPublishedCharacterVersion` for an existing version.
Publisher attribution is a durable, nullable user ID in the immutable snapshot,
not a live foreign key. An administrator can complete the normal verified
account-deletion flow without changing a version's content, attribution, or
digest. Mutable references and audit actor links may become null; durable audit
labels remain.

Archive hides a character from the public catalog and makes its public detail
URL return 404. It does not delete the draft, versions, or default pointer.
Restore makes it public again if a default is still selected. There is no
character deletion operation.

Avatar paths must be site-relative under `/characters/`, with `.svg`, `.png`,
`.webp`, `.jpg`, or `.jpeg` extensions. Remote URLs, traversal, query strings,
and fragments are rejected. Deploy the file under `public/characters` before
publication. Never overwrite an avatar referenced by a published version:
deploy a new filename and publish a version referencing that path.

### User controls and audit privacy

Disabling an ordinary account requires a reason and confirmation. It immediately
revokes **all** active sessions and rejects subsequent sign-ins. PostgreSQL
serializes session insertion with disabling: an in-flight sign-in either
creates its session first and has it revoked, or is rejected after disabling.
Authoritative session reads and protected routes also reject retained sessions
for banned users; signed-cookie caching is disabled. Restoring
clears the disabled state; the user must sign in again. There is no timed ban
or automatic expiration. Administrators cannot disable themselves or other
administrators through these controls.

Character creation, draft saves, publication, default changes, archive/restore,
and user disable/restore write audit events atomically with their state changes.
Each service also re-reads and share-locks the acting user inside its write
transaction, requiring the current role to be exactly `admin` and the user not
to be banned. Server-action guards remain in place; a stale or forged actor
object cannot authorize a write after demotion or disabling.
Events retain the actor label, target, operation ID, timestamp, and small
metadata such as version numbers, lifecycle state, and changed field names.
Audit pages and operational logs must not copy full character packages,
disable-reason text, passwords, tokens, or private user content. A disable
reason is stored in the authentication ban record, not displayed in the audit
view; audit is not a private-message inspection interface.

Phase 3 deliberately excludes long-term memory, user-created/shared characters,
marketplace/social features, avatar uploads/object storage, public history
browsing, web administrator-role management, automatic ban expiry, voice,
image generation, RAG, plugins, billing, and relationship levels.

### Automatic memory extraction (Phase 4)

Successful current replies now create durable extraction runs in the same
transaction as chat settlement. Only attempts created after memory settings
were initialized and admitted with recording enabled are eligible; the captured
admission epoch is never rebased at completion. Forget or disabling recording
(including global/account controls) permanently invalidates that eligibility,
even if controls are restored before the reply finishes. Retrying the old turn
does not grant its pre-invalidation evidence a new epoch. There is no historical backfill. Recording and
prompt usage are independent controls: disabling usage does not stop recording.
Automatic direct facts are visible immediately. Inferred ordinary preferences
remain hidden until two distinct user messages support them. User edits are
authoritative; automatic confirmation cannot overwrite them.

The existing email worker additionally processes `memory-extraction` and
reconciles pending work at startup and every 30 seconds. PostgreSQL is the
source of truth; pg-boss jobs contain only a run ID. Database state allows five
total executions (initial plus four retries), with exponential backoff starting
at 60 seconds. Lost/replacement jobs do not reset that budget. The database
reconciler publishes `memory-extraction-dead-letter` atomically with a publication
receipt, independent of pg-boss retry counters; native extraction forwarding is
disabled to prevent duplicate publication. Email forwarding is unchanged. Background calls
consume instance tokens only, never user request or token allowances.

Internal execution receipts retain only canonical NFKC/whitespace-normalized,
locally policy-approved candidates
until apply, together with accounting data and hashed provider identities.
Provider sensitivity and intent flags are hints, not consent: known health,
religion, identity and exact-address facts are classified locally and require an
explicit remember request containing a complete first-person assertion of that
candidate's fact. Matching preserves the predicate and entire fact value, not
just overlapping topic words. Supported examples include “remember that I have
type 1 diabetes,” “remember that I am an Asian woman,” and “remember that I live
at 10 Main Street.” Known identity labels remain sensitive with articles or
pronouns. Topic/media references, unrelated possessions, third-person statements,
negation and hypothetical context cannot grant consent. Unrelated consent
elsewhere in the message is insufficient; ambiguous or unsupported phrasing
(including complex requests) is conservatively rejected. Credentials, keys/tokens, recovery/private-key and
payment authentication data are discarded before any recovery receipt.
They are not operational/admin metadata. Apply and settlement commit atomically;
replaying a durable receipt does not call or charge the provider again. If a
worker dies before recording the response, lease recovery charges one
conservative estimated usage record for that ambiguous call before retrying.
Forget, recording disable, account lockout, and conversation deletion prevent
stale results from applying. Credentials are never stored as memory or receipt
candidates.
Credential-bearing source messages are also rejected before recovery receipts:
provider-stripped labels cannot turn a password, passcode, MFA code, PIN, or
token into an ordinary memory. Ordinary numbers in noncredential sources are
not rejected.

### Versioned relationship summaries (Phase 4)

Memory revision changes also make an automatic relationship summary eligible.
Eligibility uses the relationship's `memoryRevision`, not the optimistic
controls revision. Summary calls receive only active memories from the same
owner, character and current epoch, plus the prior automatic summary as
untrusted data; no transcript is sent. Strict structured output is normalized
and validated against the deployment's `maxSummaryCharacters` Unicode code
point limit (up to PostgreSQL's absolute 4000-character and 16000-byte bounds),
without truncation. Configured runtime credential values are rejected before
any receipt or version can retain summary text. Automatic validation
locally matches each sensitive assertion against current active, directly
authorized sensitive memories, before receipt persistence and again on replay.
Provider labels and topic overlap cannot authorize facts; unsupported sensitive
paraphrases or compound additions fail closed. User-authored summary edits
retain their separate explicit-intent authority.
Every successful refresh
appends an immutable version and atomically advances the current pointer and
summary revision.
Edits and clears append user-edited versions, including empty content, and
remain authoritative until explicit regeneration confirms the current summary
epoch and revision. Manual summary edits require explicit intent at both the
action and service boundaries; omitted consent is false, and empty clears do
not require consent. Both manual service entry points use the runtime credential
policy by default. Edit, clear, and regenerate submissions include
`expectedMemoryEpoch` as well as `expectedRevision`, so forget cannot make an
old tab valid again when a recreated summary reaches the same revision.
Dirty drafts and destructive confirmations adopt the first authoritative
conflict refresh once, then fence further background changes until another
submission or explicit reconciliation/reset. Baseline memory form spacing,
wrapping, textarea sizing, and focus/status rules apply on mobile too.
Failed regeneration keeps the existing summary; a newly confirmed
request can retry a failed operation only within its remaining execution budget.

The same worker additively handles `relationship-summary` and reconciles
committed work at startup and every 30 seconds. It uses the same five-execution,
instance-token-only accounting and durable receipt recovery rules as
extraction. PostgreSQL publishes `relationship-summary-dead-letter` atomically
with a durable marker, so replacement queue jobs cannot restart retries or
duplicate dead letters. Memory revision changes, forget, recording disable,
account lockout and deletion fence stale results; forget removes all versions
and never creates a new automatic summary from empty forgotten data.
Operational logs and queue payloads contain operation IDs and safe categories,
never summary or memory text, provider bodies or raw provider identities.

### Memory controls, privacy, and operations

Chat's **Manage memory** link and `/app/memories` expose the same owner-scoped
screen. Recording and prompt usage are independent: **Stop recording** keeps
formed memory but cancels unapplied extraction; **Stop using in chat** keeps
items visible and optionally keeps recording, but excludes both memories and
summary from future prompts. Already-started replies keep their assembled
prompt. User-edited items and summaries cannot be silently overwritten.
Deleting a transcript keeps formed memory and cancels its unapplied extraction.
**Forget character** physically removes memory, evidence, and every summary
version, advances the relationship epoch, cancels old work, and keeps transcripts.
These actions cannot retrieve content already sent to a configured provider.

Recall is isolated by user, character, and epoch, and is serialized as quoted,
untrusted background data after platform/character rules. Mandatory chat input
and reserved output always win. Defaults allow 2048 memory tokens: at most
512 for the summary and 1536 for items, with no donation between sub-budgets.
Selection is deterministic and uses no embeddings. All runtime services and
`db:deploy` read the same mounted `app.config.yml`, including its strict `memory`
block; there are no public memory/model build arguments. `db:deploy` seeds
defaults without replacing administrator-edited settings. No Phase 3 transcript
is processed retroactively.

The shared worker registers extraction, summary, export, export-expiry, purge,
and email queues before advertising readiness. PostgreSQL durable operation
rows and canonical locks govern retries, cancellation, and exactly-once
background settlement; queue delivery is a wake-up mechanism. Extraction and
summary each allow five executions with exponential delay starting at 60 seconds.
Background model calls use the configured chat model and consume the **instance
monthly token budget**, not daily user chat quotas or chat request counts.
`Synced`, `Processing`, `Retrying`, and `Needs retry` are shown independently of
completed chat success. Eligible failed extraction has a user retry action.
`/admin/memory` shows queue counts, safe failure categories, processing delay,
de-identified usage, exports, and staged purge alerts/retry. It never provides
transcript, memory, summary, archive, or provider-body inspection.

`/account` requests a private asynchronous ZIP with versioned manifest and UTF-8
JSON for account/profile, conversations, memories/evidence, summaries, settings,
and user-facing usage. Authentication secrets, provider credentials/endpoints,
and other users' data are excluded. The owning current session is required to
download; responses are `private, no-store`. Archives expire **24 hours after
completion** and expiry removes bytes, rather than merely hiding a link.
Confirmed account deletion immediately revokes sessions and locks every
authorization boundary. A restartable worker then purges archives, memory,
transcripts/attempts, user-specific audit/auth data, and the user, leaving only a
content-free completed tombstone and required de-identified accounting totals.
Dead-letter purge is an operator alert, not successful deletion.

Keep application and worker logs content-free. Do not add prompts, structured
candidate JSON, private classifications with content, raw provider errors, or
archive bytes to troubleshooting output. Backups and the configured provider
have their own retention policies: application purge does not erase external
backups or provider-held copies.

## Service health

Health endpoints:

- Liveness: `http://127.0.0.1:3000/api/health/live`
- Readiness: `http://127.0.0.1:3000/api/health/ready`

Readiness reports `database`, `worker`, and `modelConfiguration` checks. Model
readiness validates the already-local URL/key/model configuration shape only;
it never calls the provider. A provider outage can fail chat requests without
making the non-chat site unready. Readiness also includes a fresh worker
heartbeat emitted only after all queue handlers register, and persisted SMTP
delivery health. Readiness does not perform extraction or contact the model.
A failed delivery makes
`worker: "error"` even while the worker is alive. Jobs remain retryable; a
later successful SMTP delivery restores health. Heartbeats, restarts, and
synthetic no-op jobs do not clear a recorded delivery failure. The public
response never includes infrastructure, email, or model-provider details.

Auth callbacks await durable queue acceptance, not SMTP. Failed signup acceptance
rolls back user/credential creation. Duplicate signup and unknown-account recovery
accept synthetic no-op jobs through the same queue so dependency failure has the
same public status/body as the corresponding real request. No-op jobs have no
email address or token and never send mail. Failed acceptance returns a sanitized
error so callers can retry; deletion does not claim a confirmation was sent.
SMTP delivery failures after acceptance are handled by the worker's bounded
retries/dead-letter queue. Password recovery revokes all existing sessions.

## Run locally

For local Node development, export a percent-encoded `DATABASE_URL` for the
PostgreSQL instance you intend to use and set the SMTP values to a reachable
mail server. The test stack exposes PostgreSQL on port `55432` and Mailpit SMTP
on port `1025`. Then apply migrations and run the app and worker in separate
terminals:

```bash
pnpm db:test:up
pnpm db:deploy
pnpm dev
pnpm worker
```

## Tests

DB-backed tests require a loopback PostgreSQL target whose name ends in `_test`,
without URL query overrides. Set `TEST_DATABASE_URL` to override the default
`postgresql://companion:companion@127.0.0.1:55432/companion_test`.
An unsafe ordinary `DATABASE_URL` is rejected before opening a pool or running
destructive SQL. Vitest files run serially, and queue suites remove their jobs
on exit; do not run multiple test commands against the same test database.
Playwright supplies the same fixed test environment to its app, worker, and
loopback-only deterministic model server, independently of your shell's
SMTP/auth/model variables. The fake model listens only on `127.0.0.1:3102`,
exists only under `tests/e2e`, and has no normal production service or control
surface. The release-only Compose extension runs it privately without a
published port. Scenario markers include `[stream]`, `[slow]`, `[interrupt]`,
`[rate-limit]`, and `[auth-fail]`; `[stall]` supports deterministic stop and
refresh acceptance. Playwright uses `tests/e2e/app.config.yml` to keep timeout
tests fast while the fake provider's slow scenario remains deterministic.

```bash
pnpm db:test:up
DATABASE_URL=postgresql://companion:companion@127.0.0.1:55432/companion_test pnpm db:migrate
pnpm test
pnpm db:deploy
pnpm test:e2e
pnpm db:test:down
```

Run the dedicated Clear Daylight browser gates after deploying the guarded test
database:

```bash
pnpm db:deploy
pnpm test:e2e:visual
pnpm test:e2e:a11y
```

The visual gate compares desktop light, desktop dark, mobile reduced-motion,
320px/200%-scale, no-JavaScript theme, error-state, and representative product
surfaces. The accessibility gate runs Axe with contrast enabled and disabled in
separate passes and verifies keyboard navigation, Escape handling, and focus
restoration. Committed baselines and runtime evidence use synthetic fixtures
and are scanned recursively for privacy sentinels. Treat all screenshot and
browser evidence as private test artifacts; do not publish or attach it outside
the controlled review process.

Before running `db:deploy` in the test sequence, ensure `.env`'s `DATABASE_URL`
targets the same guarded local test database as `TEST_DATABASE_URL`. Integration
tests share that database and may truncate the seeded catalog: **rerun
`pnpm db:deploy` immediately before every Playwright run**, even if migrations
and seeds ran earlier. Do not point this sequence at a production database.

Phase 3 E2E tests use one worker and unique public registrations verified through
Mailpit. A test-only, loopback/`_test`-guarded helper promotes only the newly
verified account, revokes its sessions, and signs in through the public UI.
It is not a production bootstrap bypass. Tests never edit seed characters.
Cleanup archives only owned test-created characters and removes fixture
sessions/credentials while retiring the fixture accounts. Immutable versions,
publisher identities, and audit history are intentionally retained, not deleted
by disabling integrity triggers. Do not run concurrent suites on this database.

Phase 4 additionally uses `[memory-direct]`, `[memory-repeat]`,
`[memory-sensitive-explicit]`, `[memory-sensitive-inferred]`,
`[memory-credential]`, `[memory-invalid-json]`, `[memory-stall]`, and `[summary]`.
Structured requests are recorded in full by the test-only provider, including
the response schema and source message, for isolation/prompt assertions.
Control endpoints require loopback peers. Held structured responses are released
explicitly, not with sleeps. Race acceptance checks the release status and waits
for the exact extraction receipt and pg-boss job to finish before checking
owner/character/current-epoch absence after delete, Forget, or recording disable.
The test-only controlled worker has a loopback export barrier on port 3103. It
pauses the real exporter after its durable claim, at the last safe yield before
canonical owner locks protect snapshot construction and publication together.
Deletion cancels that claimed job before the same execution resumes; lease and
publication invariants remain unchanged. Production starts the ordinary worker
without this barrier or its control server.
Put explicit-sensitive scenario markers **after**
a complete remember sentence, e.g. `Please remember that I have diabetes.
[memory-sensitive-explicit]`; the real policy requires sentence-scoped consent.
Browser tests clear authentication rate-limit fixture rows only in their guarded,
serial test database; production limits are unchanged.

```bash
pnpm db:deploy
pnpm playwright test tests/e2e/memory.spec.ts tests/e2e/privacy.spec.ts tests/e2e/chat.spec.ts
```

Full release gate (with the test database configured as above):

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
cp .superpowers/release-compose/app.log test-results/privacy-release/app-logs/production.log
cp .superpowers/release-compose/worker.log test-results/privacy-release/worker-logs/production.log
pnpm exec tsx tests/release/privacy-scan-cli.ts
```

Use Node **24.x** for the entire gate. On a Node 22 host, a non-destructive
alternative is `npm exec --cache .superpowers/node24-cache --yes
--package=node@24 --package=pnpm@12.5.1 -c '<gate command>'`; do not change the
engines, lockfile, package manager, or compiler versions to fit the host.
The database gate creates uniquely named `_test` databases on the guarded local
PostgreSQL service, restores `tests/release/fixtures/phase3.sql`, and compares all
23 migration hashes and public columns, constraints, indexes, triggers,
functions, and enums against a fresh deployment. That fixture was dumped from
real Phase 3 migrations `0000`–`0006`, seeded official characters/settings, a
synthetic verified account, a completed conversation/attempt, and its usage
ledger. It contains no real users or production credentials. Existing transcript,
version pin, accounting, and null extraction admission survive upgrade without
backfill; repeated seeds preserve an administrator-edited quota.

The production gate extends **the actual** `docker-compose.yml` with
`tests/release/compose.release.yml`. It builds the Node 24 production image,
restores that same Phase 3 fixture before migration, checks both app and worker,
proves readiness makes zero provider calls, signs in at `http://localhost:3300`,
reads the old transcript, and processes new extraction, summary, ZIP export,
lockout, and purge with the real worker. Its database port is loopback-only
`55542`; its private fake provider has no published port and rejects remote
control requests. This gate alone binds the fake provider inside its isolated
container network. It removes its project containers/volume/image in `finally`;
legacy builder intermediates are removed only when their IDs were produced by
this build and did not exist beforehand. Its processing result and complete
logs are kept under `.superpowers/release-compose/`. Run heavyweight build,
browser, and unit gates sequentially on small shared Docker hosts to avoid
resource contention. It never stops or resets the shared PostgreSQL/Mailpit
stack. Ports `3300` and
`55542` must be free. Docker Compose must support `!reset`/`!override`.

Privacy acceptance uses deterministic unique provider-key, provider-endpoint,
other-user, and private-memory sentinels. It captures all same-origin browser
responses (including successes and failures), complete app/worker logs,
rendered admin pages, and every file under `.next/static` and `public`.
Owner-page responses are captured before browser delivery, preserving redirects,
so a canceled prefetch or an evicted Chromium response body cannot silently
become empty scanner evidence.
`test-results/privacy-release/scan-result.json` records counts; the standalone
scanner recursively checks every captured path and fails if any required
surface is absent. Decoded ZIP entries are a separate mandatory recursive
`decoded-exports` surface, including unknown nested entries. Successful (2xx)
and error (4xx/5xx) HTTP evidence are independently mandatory and counted from
captured status metadata, never filenames or decoded archives.
Owner-facing responses and exports may legitimately show the owner's
memory, but never provider secrets/endpoints or the second user's phrase;
logs/admin/static assets must contain none of the private sentinels.
The commands above add the complete production Compose app/worker logs to the
same scan without replacing the browser-run logs.
The ZIP is separately expanded and checked, and expiry/purge are checked in
PostgreSQL. Artifacts contain synthetic private test data and are Git-ignored:
do not publish them. Independent whole-branch review remains a separate
pre-merge acceptance gate.

Every command must pass; Drizzle must report no schema changes and create no
migration. Run `db:deploy` immediately before Playwright because integration
tests can truncate seeds. The compiler commands must print `Version 7.0.2` and
`6.0.3`. The lint toolchain uses the TypeScript 7 compiler plus the official
TypeScript 6 API compatibility package, so `pnpm lint` runs the full source
lint without a TypeScript 7 compiler-API startup exception. Do not downgrade
the compiler, bypass preflight, disable lint rules, or substitute a different
tooling API to claim a green gate. `pnpm build` runs native TypeScript 7
preflight typechecking before `next build`.

Next 16 automatically maintains both production and development route-type
includes in `tsconfig.json` during `next typegen`/build; these generated-directory
globs are not checked-in type artifacts and need not exist on a clean checkout.

## Backups and operations

Back up both the PostgreSQL database and `app.config.yml`. The database holds
accounts and durable jobs; the YAML file holds the instance identity and
public operating policy. Store `.env` securely in your secret-management
system and test restoration procedures before relying on backups.

Stop the production stack with:

```bash
docker compose down
```
