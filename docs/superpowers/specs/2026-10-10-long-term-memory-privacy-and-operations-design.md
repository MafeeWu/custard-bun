# Long-Term Memory, Privacy, and Operational Completion Design

**Date:** 2026-10-10  
**Status:** Approved design, pending implementation plan  
**Roadmap phase:** Phase 4  
**Depends on:** Phase 3 streaming chat, model gateway, quotas, and administration

## 1. Purpose

Phase 4 gives each user-character relationship durable, user-controlled
memory. A character can recall stable facts and shared context in a new
conversation without exposing data across users or characters.

The phase also completes the privacy lifecycle around that memory:

- users can inspect, edit, delete, disable, and fully forget memories;
- conversation deletion remains distinct from relationship forgetting;
- users can export their data;
- account deletion immediately revokes access and then purges all data
  asynchronously;
- operators can monitor background processing without seeing private content.

Success is not merely that a model appears to remember something. The
application must prove that memory is durable, bounded, attributable,
isolated, removable, and absent from later prompts after deletion.

## 2. Binding Product Decisions

The following decisions are part of the approved product behavior.

### 2.1 Activation and transparency

- Automatically extracted memories become active without per-item approval.
- Every active memory is visible on a user-facing memory management screen.
- Users can edit or delete any memory.
- User edits are authoritative and cannot be silently overwritten by later
  automatic extraction.

### 2.2 Sensitive information

Sensitive information uses a tiered policy.

The system must never persist credential-class secrets, even when the user asks:

- passwords;
- one-time or multi-factor authentication codes;
- API keys, access tokens, session tokens, and private keys;
- card or bank authentication credentials;
- recovery codes or equivalent authentication material.

The system may persist personal sensitive information only when the user
explicitly asks the character to remember it:

- health information;
- religion;
- sensitive identity information;
- precise addresses;
- comparable high-risk personal facts.

The system must never infer sensitive identity traits.

### 2.3 Ordinary inference

- Directly expressed facts and preferences may become active immediately.
- Ordinary, non-sensitive preferences inferred from behavior require evidence
  from at least two distinct user messages.
- Repeated evidence begins at lower confidence and can raise confidence or
  recency on an existing item.
- A single contextual mention is not enough to create an inferred durable
  preference.

### 2.4 Relationship summary

- Each user-character relationship has one current compact summary.
- The user can view, edit, clear, and request regeneration of the summary.
- User-edited summaries cannot be silently overwritten by automatic refresh.
- Summary history is versioned for application-level concurrency and recovery.

### 2.5 Deletion and disablement

- Deleting a conversation keeps durable memories and shows an explicit warning.
- "Make this character forget me" deletes the relationship summary and all
  memories for that user-character pair.
- Recording new memories and using existing memories in chat are separate
  controls.
- Forgetting or deleting memory must prevent in-flight background work from
  recreating the deleted data.

### 2.6 Background cost

- Memory extraction and summary refresh use the deployer's configured model.
- Background memory calls consume the instance monthly token budget.
- They do not consume the user's daily chat request or token limits.
- Background memory operations are recorded in the usage ledger with a
  non-chat workload type.

### 2.7 Failure visibility

- A completed chat remains successful if memory processing fails.
- The memory screen shows low-distraction processing state:
  `synced`, `processing`, `retrying`, or `needs_retry`.
- A persistently failed relationship can be retried by the user.
- Memory processing errors do not appear as chat timeline messages.

### 2.8 Export and account deletion

- Data export is an asynchronous ZIP containing structured JSON.
- The archive is available for 24 hours and requires an authenticated session.
- Confirmed account deletion immediately revokes sessions and access.
- A background purge removes all remaining data in idempotent stages.

## 3. Scope

### 3.1 Included

- structured user-character memories;
- relationship summaries;
- automatic extraction after completed model responses;
- deterministic duplicate merging and recall without embeddings;
- memory token budgeting in chat prompts;
- memory and summary management UI;
- per-relationship recording and usage controls;
- per-character forgetting;
- privacy-safe worker retry and dead-letter handling;
- asynchronous full data export;
- asynchronous cross-module account purge;
- memory and purge operational dashboards;
- complete unit, integration, worker, UI, and browser acceptance coverage.

### 3.2 Excluded

- embeddings, vector databases, or semantic search infrastructure;
- retrieval-augmented generation over external documents;
- user-authored or public characters;
- relationship levels, affection scores, or game mechanics;
- cross-character memory;
- sharing memory between users;
- administrator access to message, memory, summary, or export content;
- arbitrary model selection or a separate memory model;
- importing an archive back into the application;
- retroactive extraction from conversations created before Phase 4.

## 4. Architecture

Phase 4 keeps the existing modular monolith:

- Next.js handles authenticated pages, actions, APIs, and downloads.
- PostgreSQL is the only required stateful dependency.
- pg-boss runs extraction, summary, export, purge, retry, and cleanup work.
- The existing OpenAI-compatible model gateway handles model calls.
- Docker Compose remains the supported self-hosted deployment.

The database is the source of truth for all job eligibility and state. pg-boss
delivery is a wake-up mechanism, not the sole record that work exists.

### 4.1 Module boundaries

Add focused server modules:

- `memory-schema`: Drizzle tables and database constraints;
- `memory-policy`: normalization, sensitivity, evidence, and merge rules;
- `memory-service`: user-facing edits, deletes, settings, and forgetting;
- `memory-queries`: ownership-safe reads and prompt recall;
- `memory-extraction`: model contract, candidate validation, and application;
- `relationship-summary`: automatic and user-edited summary versions;
- `memory-jobs`: durable enqueue, retry, reconciliation, and worker handlers;
- `data-export`: snapshot, archive generation, download, and expiry;
- `account-purge`: immediate lockout and idempotent purge stages;
- `memory-operations`: privacy-safe aggregate operational queries.

Each module exposes typed inputs and results. UI code must not issue direct
table queries or reconstruct policy decisions.

## 5. Runtime Configuration

Add a strict `memory` block to public deployment configuration:

```yaml
memory:
  enabled: true
  promptTokenBudget: 2048
  relationshipSummaryTokenBudget: 512
  memoryItemsTokenBudget: 1536
  maxActiveItemsPerCharacter: 200
  maxItemCharacters: 500
  maxSummaryCharacters: 4000
  extractionRetryLimit: 5
  extractionRetryDelaySeconds: 60
  exportRetentionHours: 24
  maxExportArchiveBytes: 262144000
```

Validation rules:

- both memory prompt sub-budgets must be positive;
- their sum must not exceed `promptTokenBudget`;
- memory `promptTokenBudget` must be smaller than the overall chat prompt token
  budget; request-time assembly still reserves output and mandatory platform,
  character, and current-message content before optional memory;
- retry limits and delays must be bounded;
- export retention is fixed to 24 hours for the initial release;
- the maximum archive size must be positive and capped to a safe operator
  maximum.

Operational administrator settings may enable or disable memory processing for
the whole instance, but they cannot weaken the sensitive-information policy.

Deployment defaults seed idempotently. As with chat settings, a later deploy
must not overwrite administrator-edited operational values.

## 6. Data Model

### 6.1 User-character memory settings

`user_character_memory_settings`

- `user_id`
- `character_id`
- `recording_enabled`
- `usage_enabled`
- `memory_epoch`
- `created_at`
- `updated_at`
- `revision`

Constraints:

- primary key `(user_id, character_id)`;
- character and user ownership cannot change;
- `memory_epoch` only increases;
- `revision` only increases;
- a missing row means both controls use the deployment defaults and epoch zero.

`memory_epoch` invalidates work created before forgetting or account deletion.

### 6.2 Memory items

`memory_items`

- `id`
- `user_id`
- `character_id`
- `memory_epoch`
- `type`
- `content`
- `normalized_content`
- `normalized_digest`
- `origin` (`automatic`, `user_edited`)
- `sensitivity` (`ordinary`, `personal_explicit`)
- `explicitness` (`direct`, `repeated_inference`)
- `confidence`
- `importance`
- `first_observed_at`
- `last_confirmed_at`
- `user_edited_at`
- `created_at`
- `updated_at`
- `revision`

Initial memory types:

- `preferred_name`
- `preference`
- `important_person`
- `personal_fact`
- `future_plan`
- `shared_event`
- `commitment`
- `other`

Constraints:

- every row belongs to exactly one user and one character;
- `memory_epoch` must equal the current relationship epoch when inserted;
- content and normalized content have strict length limits;
- confidence and importance use bounded integer scales;
- normalized digest uniqueness prevents duplicate active items for one
  user-character/type/epoch combination;
- user-edited rows cannot be updated by automatic merge paths;
- privacy deletion physically removes item content rather than retaining a
  soft-deleted copy.

### 6.3 Memory evidence

`memory_evidence`

- `id`
- `memory_id`
- `source_message_id`, nullable after conversation deletion
- `source_attempt_id`, nullable after conversation deletion
- `source_deleted_at`
- `observed_at`
- `evidence_kind` (`direct`, `supporting`)

Constraints:

- one message can support a given memory only once;
- the source user message must have belonged to the same user and character;
- evidence never copies message text;
- conversation deletion sets source references to null and records only that
  the source was deleted.

Evidence rows support duplicate merging and repeated-inference thresholds
without retaining deleted transcript content.

### 6.4 Extraction runs

`memory_extraction_runs`

- `id`
- `user_id`
- `character_id`
- `conversation_id`, nullable after conversation deletion
- `generation_attempt_id`, nullable after conversation deletion
- `memory_epoch`
- `status` (`pending`, `queued`, `running`, `retrying`, `complete`, `failed`,
  `dead_letter`, `cancelled`)
- `job_id`
- `attempt_count`
- `next_retry_at`
- `error_category`
- `provider_request_ids`
- `estimated_input_tokens`
- `input_tokens`
- `output_tokens`
- `usage_estimated`
- `created_at`
- `started_at`
- `finished_at`
- `updated_at`

Constraints:

- one run per completed generation attempt;
- one active pg-boss job identity per run;
- provider error bodies and messages are never stored;
- terminal runs cannot return to active states;
- deleting the source conversation cancels every nonterminal run tied to its
  messages; a worker already holding a result must recheck source existence
  before applying it;
- a run may apply results only when its captured epoch still equals the
  relationship's current epoch.

### 6.5 Relationship summaries

`relationship_summaries`

- `user_id`
- `character_id`
- `memory_epoch`
- `current_version_id`
- `revision`
- `updated_at`

`relationship_summary_versions`

- `id`
- `user_id`
- `character_id`
- `memory_epoch`
- `content`
- `origin` (`automatic`, `user_edited`)
- `based_on_memory_revision`
- `created_at`

Constraints:

- primary relationship row is unique by user and character;
- current version must belong to the same user, character, and epoch;
- automatic refresh cannot replace a current user-edited version;
- clearing the summary creates an explicit empty user-edited version;
- forgetting physically deletes all summary versions.

### 6.5.1 Summary refresh runs

`relationship_summary_runs`

- `id`
- `user_id`
- `character_id`
- `memory_epoch`
- `expected_summary_revision`
- `based_on_memory_revision`
- `status` (`pending`, `queued`, `running`, `retrying`, `complete`, `failed`,
  `dead_letter`, `cancelled`)
- `job_id`
- `attempt_count`
- `next_retry_at`
- `error_category`
- `provider_request_ids`
- `estimated_input_tokens`
- `input_tokens`
- `output_tokens`
- `usage_estimated`
- `created_at`
- `started_at`
- `finished_at`
- `updated_at`

Constraints:

- one run per user-character/epoch/memory-revision combination;
- one active pg-boss job identity per run;
- terminal runs cannot return to active states;
- a run may apply only when epoch, expected summary revision, and memory
  revision still match;
- forgetting or account lockout cancels every nonterminal run.

### 6.6 Usage ledger extension

Extend usage accounting with:

- `workload_type`:
  `chat_generation`, `memory_extraction`, `summary_refresh`;
- optional `memory_extraction_run_id`;
- optional `relationship_summary_version_id`.

Background workloads:

- consume instance monthly token budget;
- do not consume user daily chat quotas;
- do not consume the instance chat request limit;
- record provider calls, tokens, estimated usage, latency, model ID, and safe
  failure category.

Exactly-once settlement uses the run or summary operation identity.

### 6.7 Export jobs

`data_export_jobs`

- `id`
- `user_id`
- `status` (`pending`, `running`, `complete`, `failed`, `expired`,
  `cancelled`)
- `job_id`
- `archive_bytes`
- `archive_size`
- `archive_sha256`
- `error_category`
- `created_at`
- `started_at`
- `completed_at`
- `expires_at`
- `downloaded_at`
- `updated_at`

Constraints:

- at most one nonterminal export per user;
- archive bytes exist only for a completed, unexpired job;
- archive size must not exceed the configured maximum;
- only the owning authenticated user may inspect or download an export;
- expiry physically removes archive bytes.

### 6.8 Account purge

`account_deletion_requests`

- `id`
- `user_id`, nullable only after the final purge stage
- `verification_token_hash`, nullable after confirmation
- `verification_expires_at`, nullable after confirmation
- `verification_consumed_at`
- `status` (`pending_confirmation`, `locked`, `purging`, `complete`,
  `dead_letter`)
- `current_stage`
- `job_id`
- `confirmed_at`
- `locked_at`
- `completed_at`
- `error_category`
- `attempt_count`
- `updated_at`

The authentication user gains a deletion-pending state used by every session
and authorization boundary.

Purge audit records may retain only:

- deletion request ID;
- former user ID;
- stage;
- timestamps;
- safe error category.

They must not retain email, profile fields, message content, memory content, or
archive data after purge completes.

The final purge stage sets `user_id` to null before deleting the authentication
user, leaving only the content-free request identifier, stage, status, and
timestamps.

Only a hash of the deletion verification token is stored. Confirmation compares
the presented token in constant time, requires an unexpired unused hash, then
clears the hash and records `verification_consumed_at`.

## 7. Canonical Lock Order

Memory, chat, administration, export, and deletion share one lock discipline.

When an operation needs the corresponding resources, acquire them in this
order:

1. global chat/memory settings singleton;
2. per-user advisory mutation lock;
3. authentication user row;
4. user-character memory settings rows ordered by character ID;
5. extraction run or export/deletion request row;
6. relationship summary row;
7. memory item rows ordered by ID;
8. evidence rows.

Rules:

- no operation may acquire the global singleton after acquiring a user lock;
- worker settlement follows the same order as interactive mutations;
- user edits, forgetting, account lockout, extraction application, and summary
  refresh serialize through the per-user advisory lock;
- reads do not lock unless they perform expiry or pending-work reconciliation;
- concurrency tests must use separate PostgreSQL connections and observed lock
  waits rather than Promise timing.

## 8. Extraction Pipeline

### 8.1 Eligibility

Create an extraction run only when:

- the assistant attempt reaches `complete`;
- it is still the current attempt for its assistant slot;
- the conversation, user, and character relationship still exist;
- global memory processing is enabled;
- relationship recording is enabled;
- the user is active and not pending deletion.

Failed and interrupted attempts do not create memory.

The transaction that finalizes the chat inserts the unique pending extraction
run. Enqueue happens after commit. A reconciliation loop scans pending runs so
a process crash between commit and pg-boss delivery cannot lose work.

### 8.2 Model input

The extraction call receives only:

- the completed user message;
- the completed assistant response;
- stable character identity, not provider configuration;
- the approved memory type list;
- sensitivity and explicitness rules;
- a strict JSON response schema.

It does not receive unrelated conversations or another character's memories.

Assistant text may inform shared events or commitments but cannot serve as the
sole evidence for a user fact. Durable facts require a source user message.

### 8.3 Candidate contract

Each candidate contains:

- type;
- proposed user-visible content;
- normalized content;
- source user message ID;
- direct or repeated-inference classification;
- ordinary or personal-explicit sensitivity classification;
- confidence;
- importance;
- optional merge target digest.

The provider response is untrusted. The service:

1. parses strict JSON with size and depth limits;
2. rejects unknown keys and enum values;
3. verifies every source message against the run's user and character;
4. rejects credential-class secrets;
5. rejects personal-sensitive candidates without explicit remember language;
6. normalizes content locally;
7. computes the digest locally;
8. applies evidence and merge rules in a transaction.

### 8.4 Merge behavior

- A direct candidate creates a new item or confirms an existing automatic item.
- A repeated-inference candidate activates only after two distinct source user
  messages.
- Duplicate confirmation updates last-confirmed time, confidence, importance,
  and evidence without changing stable user-visible text unnecessarily.
- Automatic candidates never modify a user-edited item.
- An explicit new correction may replace an automatic item through a new
  revision-safe service operation.
- Old extraction results fail closed when epoch, ownership, current attempt, or
  deletion state no longer matches.

### 8.5 Retry and dead-letter

Default behavior:

- five attempts;
- exponential backoff beginning at 60 seconds;
- safe retry for timeout, provider rate limit, transient server failure,
  database serialization failure, and temporary instance-budget exhaustion;
- no retry for invalid structured output after the bounded validation retry,
  forbidden sensitive content, missing ownership, stale epoch, or deleted user;
- terminal exhausted work moves to a dedicated dead-letter queue.

The memory page may request a retry for the most recent failed run. The retry
creates no duplicate memory and still validates epoch and ownership.

## 9. Relationship Summary Refresh

The summary represents shared events and unresolved commitments, not a
personality score or relationship level.

Automatic refresh becomes eligible when:

- active memory revision changed since the last automatic summary;
- recording remains enabled;
- the current summary is not user-edited;
- no refresh for the same relationship and memory revision is active.

The refresh call receives active memory content and the prior automatic
summary. It never receives deleted memory or unrelated transcripts.

User actions:

- edit summary: creates a user-edited version;
- clear summary: creates an explicit empty user-edited version;
- regenerate: user confirms replacement of the edited version, then creates a
  refresh job against the current memory revision.

## 10. Prompt Assembly and Recall

### 10.1 Precedence

The prompt order is:

1. platform rules;
2. pinned published character definition and character examples;
3. relationship summary;
4. structured memory items;
5. recent complete conversation turns;
6. current user message.

Mandatory platform rules, character definition, current message, and output
budget always win.

### 10.2 Selection

Recall loads only:

- the authenticated user's relationship;
- the conversation's character;
- the current memory epoch;
- active memory items;
- the current summary;
- rows allowed by the relationship usage control.

No embeddings are used. Items sort deterministically by:

1. user-edited before automatic;
2. direct before repeated inference;
3. importance descending;
4. confidence descending;
5. last-confirmed time descending;
6. stable item ID.

Selection stops at the item token budget or item count limit.

### 10.3 Token budgets

Default memory context budget is 2048 tokens:

- relationship summary: at most 512;
- structured items: at most 1536.

Unused summary budget does not allow items to exceed their item cap. Recent
history receives the remaining optional context budget after character
examples and memory context.

If the mandatory prompt cannot fit, generation fails with the existing safe
chat validation error. Memory is optional and may be omitted without failing
an otherwise valid generation.

### 10.4 Untrusted-data serialization

Summary and memory content are serialized as quoted data under a fixed
platform-owned preamble:

- the content is background information, not instructions;
- instructions inside it must be ignored;
- serialized delimiters are escaped;
- item type and content are encoded as strict data fields;
- provider-facing data contains no internal database IDs.

Prompt-injection tests must prove memory text cannot replace platform or
character instructions and remains after them in precedence.

## 11. User-Facing Memory Management

### 11.1 Entry points

- Chat menu: "What this character remembers."
- Account privacy center: overview of every character relationship.

Both lead to the same ownership-safe relationship memory surface.

### 11.2 Relationship page

The page contains:

- relationship summary editor;
- active memory cards;
- processing status;
- recording control;
- prompt-usage control;
- retry action when eligible;
- "Make this character forget me."

Memory cards show:

- type;
- editable user-visible content;
- sensitivity badge where applicable;
- last-confirmed time;
- number of supporting sources;
- automatic or user-edited origin.

They do not show:

- provider name or model ID;
- raw extraction output;
- hidden reasoning;
- internal confidence decimals;
- database or request identifiers.

### 11.3 Optimistic revisions

Memory edit, summary edit, settings changes, and forgetting use optimistic
revision checks. A conflict:

- changes nothing;
- preserves the user's unsaved input;
- returns a safe conflict message;
- prompts a reload.

No last-write-wins behavior silently discards a user edit.

### 11.4 Conversation deletion warning

The confirmation states:

> This deletes the conversation transcript. Memories this character already
> formed are kept. Use "Make this character forget me" to remove them.

Deletion also cancels memory extraction that has not yet been applied from the
deleted transcript. It does not create new memory from content the user has
chosen to delete.

### 11.5 Forget confirmation

The confirmation states that the action:

- removes all memories and the relationship summary for this character;
- cancels pending memory work;
- does not delete conversation transcripts;
- cannot be undone.

## 12. Data Export

### 12.1 Request

An authenticated active user may have at most one nonterminal export job.
Requesting an export:

1. acquires the user mutation lock;
2. rejects pending-deletion users;
3. inserts the job;
4. enqueues after commit.

### 12.2 Snapshot

The worker opens a repeatable-read transaction and exports only the requesting
user's data:

- account and profile fields;
- character relationships and settings;
- conversations and messages;
- generation attempts and user-visible safe statuses;
- memories and evidence metadata;
- relationship summaries;
- user-facing quota and usage records;
- administrative actions performed on that user, without other users' data.

It excludes:

- password hashes and authentication secrets;
- provider keys and endpoints;
- internal rate-limit keys;
- other users' identifiers or content;
- raw provider errors;
- operator-only configuration.

### 12.3 Archive

The archive:

- is a ZIP;
- contains a versioned manifest and JSON files;
- uses UTF-8;
- records export creation time and schema version;
- is checked against the configured maximum before commit;
- is stored in PostgreSQL as `bytea`;
- has a SHA-256 digest and exact size;
- expires 24 hours after completion.

Download requires a current authenticated session and matching owner. The route
uses `Cache-Control: private, no-store` and content-disposition attachment
headers.

Expiry and account purge physically remove archive bytes.

## 13. Account Deletion

Phase 4 replaces final synchronous Better Auth deletion with an application
owned staged workflow. Better Auth's direct hard-delete path must not remove
the user row before cross-module purge completes.

### 13.1 Confirmation

The existing email-verification requirement remains. Confirming deletion:

1. acquires global settings and the user mutation lock;
2. rechecks the authenticated user;
3. marks the user pending deletion;
4. revokes all sessions;
5. requests cancellation for active generations;
6. increments every relationship memory epoch;
7. cancels pending extraction, summary, and export work;
8. creates the unique purge request;
9. enqueues purge after commit.

Every protected page and API rejects a pending-deletion user.

### 13.2 Purge stages

Purge is restartable and records its current stage:

1. settle or reconcile active generation accounting;
2. delete export archives and export jobs;
3. delete memory evidence, items, summaries, settings, and memory jobs;
4. delete conversations, messages, attempts, reservations, and leases while
   preserving required de-identified usage totals;
5. delete user-specific audit metadata not required for operator integrity;
6. delete authentication accounts, verification tokens, sessions, and user;
7. mark the deletion request complete using a content-free tombstone.

Each stage is idempotent. Re-running a completed stage is safe.

Dead-letter purge work is a high-priority operational alert. Administrators can
retry by request ID but cannot inspect deleted content.

## 14. Operations and Administration

Add aggregate operational views for:

- pending, running, retrying, failed, and dead-letter memory jobs;
- p50 and p95 processing delay;
- extraction and summary token totals;
- estimated-usage count;
- exports by state and expired archive bytes awaiting cleanup;
- purge requests by stage and age;
- oldest pending job;
- safe failure categories.

Administration must not query or render:

- message content;
- memory content;
- relationship summary content;
- source message IDs linked to a user-visible transcript;
- export archives;
- provider response bodies.

Operational logs use job, run, user, and character identifiers only where
needed. They never log prompt content, candidate JSON, archive bytes, or
sensitive memory classifications with content.

## 15. Error Contract

Add stable user-facing errors:

- memory disabled globally;
- recording disabled;
- memory not found;
- revision conflict;
- relationship not found;
- extraction already active;
- retry unavailable;
- export already active;
- export too large;
- export expired;
- deletion pending;
- operation unavailable during deletion.

Provider and structured-output details remain internal. Public messages are
code-owned and metadata uses the existing sanitizer.

Chat generation does not fail because:

- extraction enqueue is delayed after the durable run is inserted;
- an extraction job fails;
- summary refresh fails;
- memory context is empty or cannot fit its optional budget.

## 16. Testing Strategy

### 16.1 Unit tests

- strict extraction JSON parsing and unknown-key rejection;
- local normalization and digest generation;
- duplicate merge behavior;
- direct versus repeated-inference evidence thresholds;
- credential rejection;
- explicit personal-sensitive opt-in;
- no sensitive-trait inference;
- user-edited memory protection;
- deterministic recall ordering;
- token budget trimming;
- untrusted memory serialization and delimiter escaping;
- export manifest generation and redaction.

### 16.2 PostgreSQL integration tests

- one extraction run per current completed attempt;
- no run for failed, interrupted, or superseded attempts;
- duplicate worker delivery is exactly once;
- stale epoch cannot apply results;
- forgetting waits on and invalidates in-flight application;
- user edit and automatic merge serialize without overwrite;
- cross-user and cross-character isolation;
- conversation deletion retains memory and removes source references;
- forgetting removes memory and summary but retains transcript;
- background token settlement is exactly once;
- instance budget admission for memory work;
- export snapshot ownership and repeatable-read consistency;
- export expiry removes archive bytes;
- account lockout and each purge stage are idempotent;
- no lock-order deadlocks under separate observed-wait connections.

### 16.3 Worker tests

- durable pending-run reconciliation after enqueue crash;
- bounded retries and exponential backoff;
- dead-letter routing;
- budget-exhaustion delay;
- invalid output terminal handling;
- cancellation before and after provider response;
- stale epoch discard;
- summary refresh protection for user edits;
- export retry without duplicate archives;
- purge resume from every stage.

### 16.4 UI and route tests

- ownership on every memory, export, retry, and forget action;
- optimistic revision conflicts preserve user input;
- recording and usage controls are independent;
- processing status and retry eligibility;
- exact deletion confirmations;
- archived conversations and deleted transcripts do not expose source content;
- export response headers and expiry behavior;
- pending-deletion users cannot use retained sessions;
- administrator pages contain no memory or message content.

### 16.5 Browser acceptance

The primary acceptance scenario:

1. register and verify a user;
2. start a conversation with a character;
3. state a durable preference;
4. complete the response and memory job;
5. restart into a new conversation;
6. inspect the fake provider request and verify correct recall;
7. delete the memory;
8. restart again;
9. verify the deleted fact is absent from the provider request.

Additional browser scenarios:

- the same fact never crosses to another user;
- the same fact never crosses to another character;
- two-message inference does not activate after only one message;
- explicit personal-sensitive opt-in works while credentials never persist;
- conversation deletion retains memory with a warning;
- "forget me" removes memory and summary but keeps transcript;
- recording and usage switches act independently;
- failed processing shows retry without changing chat success;
- export contains only the user's data and expires;
- confirmed account deletion immediately ends access and eventually purges all
  content.

## 17. Migration and Deployment

The Phase 4 migration:

- adds memory, summary, export, and deletion tables;
- extends usage workload types;
- adds the pending-deletion account state;
- adds pg-boss queues and dead-letter queues;
- seeds instance memory settings;
- does not scan or extract from existing conversations.

Only completed responses created after Phase 4 deployment become extraction
eligible.

`db:deploy` remains:

1. migrations;
2. official character seed;
3. chat settings seed;
4. memory settings seed;
5. queue bootstrap where required.

Existing Phase 3 conversations remain readable and usable throughout rolling
deployment. The worker must tolerate old rows that lack memory work.

## 18. Release Gate

Phase 4 is complete only when all of the following pass:

- frozen dependency installation;
- migration against a fresh database;
- migration against a Phase 3 database;
- complete Vitest suite;
- typecheck;
- lint;
- production build;
- repeated idempotent deploy;
- complete Playwright suite;
- schema generation with no drift;
- Docker Compose startup and readiness;
- fake-provider recall and forgetting acceptance;
- account purge completion;
- privacy scan of browser responses, logs, admin HTML, and static assets;
- independent whole-branch code review.

The roadmap may mark Phase 4 complete only after this gate is green.

## 19. Acceptance Criteria

Phase 4 is accepted when:

- a character recalls a durable preference in a new conversation;
- deleted or forgotten memory is absent from every later prompt;
- memory cannot cross user or character boundaries;
- user edits are not overwritten automatically;
- credentials never persist;
- personal-sensitive memory requires explicit user intent;
- deleting a conversation does not silently delete memory;
- forgetting prevents in-flight work from restoring deleted content;
- recording and usage can be disabled independently;
- memory failures are recoverable without changing completed chat status;
- exports are complete, private, bounded, and removed after 24 hours;
- confirmed account deletion immediately revokes access and eventually removes
  all private content;
- administrators can operate queues and purges without access to private
  content;
- deployment still requires only PostgreSQL as persistent state.
