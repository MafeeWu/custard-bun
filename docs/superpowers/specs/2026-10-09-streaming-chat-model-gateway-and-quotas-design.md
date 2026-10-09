# Streaming Chat, Model Gateway, and Quotas Design

**Date:** 2026-10-09  
**Phase:** 3 of the AI Companion delivery roadmap  
**Status:** Approved conversational design; written specification awaiting review

## 1. Purpose

Phase 3 turns the existing deployable account and official-character system
into a private AI chat product.

An authenticated user can start a conversation with an official character,
receive a streamed response from a deployer-configured OpenAI-compatible
provider, stop or retry incomplete generations, and understand quota or
provider failures without seeing infrastructure details. Each conversation
pins the immutable character version selected when that conversation starts.

The implementation must preserve the product's self-hosted deployment model:

- one modular Next.js application;
- one PostgreSQL database;
- the existing worker for asynchronous work;
- no browser access to provider credentials;
- no additional required stateful service; and
- no administrator access to private message content through normal product
  interfaces.

## 2. Confirmed Product Decisions

The following decisions are requirements, not implementation suggestions:

1. A user may have at most one active conversation with a given character.
2. Starting over archives the current active conversation and creates a new
   active conversation pinned to the character's current default version.
3. Archived conversations are read-only and cannot be restored.
4. Active and archived conversations can both be permanently deleted.
5. The published character opening message is persisted as the first complete
   assistant message without calling the model.
6. A user can stop generation. Persisted partial output remains visible with
   an explicit `interrupted` state.
7. A manual retry replaces the failed or interrupted assistant bubble in the
   normal timeline while retaining prior attempts and their usage internally.
8. Phase 3 sends only the most recent complete turns that fit the prompt
   budget. It does not create a rolling summary or long-term memory.
9. Subsequent replies use the deployment's current model configuration.
   Conversations pin character versions, not model identifiers. Every attempt
   records the actual model identifier used.
10. User and instance limits cover both user-initiated request counts and
    tokens.
11. User quota periods are UTC calendar days. Instance budget periods are UTC
    calendar months.
12. Administrators can set global limits and per-user request/token overrides.
13. A user may have only one active generation across all characters.
14. The chat page uses a focused single-column layout. History, restart, and
    deletion controls live in a drawer or overflow action instead of a
    permanently visible side panel.
15. Messages support safe Markdown. Raw HTML, scripts, images, and automatic
    embeds are not rendered.

## 3. Scope

### 3.1 Included

- Conversation and message persistence
- One active conversation per user-character pair
- Read-only archived conversation history
- Immutable character-version pinning
- Fixed published opening messages
- OpenAI-compatible streaming model gateway
- Prompt assembly with explicit precedence and token budgets
- Recent-turn context selection
- Partial response persistence
- User-requested cancellation
- Automatic retry before the first output token only
- Manual retry for failed or interrupted replies
- Explicit pending, streaming, complete, interrupted, and failed states
- User daily request and token quotas
- Instance monthly request and token budgets
- One active generation per user
- Configurable instance-wide concurrency
- Global quota administration and per-user overrides
- Aggregate usage and provider-failure administration
- Safe Markdown rendering
- Typed, privacy-safe errors and operational logging

### 3.2 Excluded

- Long-term memory, relationship summaries, and rolling conversation summaries
- Editing sent user messages
- Regenerating an already successful assistant response
- Resuming an archived conversation
- Multiple simultaneous active conversations with one character
- User-facing provider or model selection
- Multi-model routing or fallback
- User-created or shared characters
- Voice, image generation, multimodal input, RAG, and plugins
- Paid plans, provider billing reconciliation, or currency-denominated budgets
- Administrator access to conversation text
- Data export and relationship-level forgetting, which remain Phase 4 work

## 4. Architecture

### 4.1 Runtime boundaries

The Next.js application owns:

- authenticated chat pages;
- conversation lifecycle actions;
- the streaming HTTP endpoint;
- quota admission and settlement;
- prompt assembly;
- model gateway invocation;
- partial response persistence; and
- usage and failure queries for administrators.

The existing worker remains responsible for asynchronous jobs. Interactive
generation does not go through pg-boss because queue-mediated token delivery
would add latency, database chunk traffic, cancellation complexity, and another
failure boundary without improving the initial product.

The model gateway is a server-only module. It accepts a provider-independent
chat request and emits a provider-independent event stream. Only this module
knows the OpenAI-compatible request and response shape.

### 4.2 Streaming transport

The browser sends an authenticated `POST` request with an idempotency key.
The response uses newline-delimited JSON with a versioned event schema:

- `started`
- `delta`
- `completed`
- `failed`
- `interrupted`

NDJSON supports a request body, incremental `fetch()` consumption, typed
payloads, and ordinary HTTP deployment. Phase 3 does not require WebSockets.

The browser never receives:

- the provider base URL;
- the API key;
- raw provider response bodies;
- provider authentication details; or
- internal stack traces.

### 4.3 Short transactions and leases

No database transaction remains open while waiting for the model.

Admission uses one short transaction to validate ownership and state, reserve
quota, acquire a generation lease, and create the logical message and initial
attempt. Streaming happens after commit. Checkpoints use short independent
updates. Completion or failure uses a final short transaction to settle usage,
release reservations, and close the lease.

Each active attempt has an expiring generation lease. A lease includes the
attempt, user, expiry, and opaque owner token. The user ID is unique among
active leases, enforcing one generation per user. Admission serializes through
the global chat-settings row before checking instance concurrency, so two
concurrent requests cannot both consume the final slot.

Expired leases are reconciled before admission and when affected conversations
are read. An unfinished attempt whose lease expired becomes `interrupted`; its
last persisted partial text remains available.

## 5. Runtime Configuration

### 5.1 Secret environment configuration

Strict secret configuration adds:

- `MODEL_API_BASE_URL`
- `MODEL_API_KEY`
- `MODEL_ID`

The base URL must use `http` or `https`. Plain HTTP remains valid for trusted
local self-hosted model servers. The application appends the supported
OpenAI-compatible chat-completions path without exposing the resulting URL.

Provider credentials are loaded only on the server. Invalid or missing values
fail startup with sanitized configuration diagnostics.

### 5.2 Public deployment configuration

`app.config.yml` adds a strict `chat` section containing deployment defaults
and non-secret safety bounds:

- first-token timeout;
- total request timeout;
- prompt token budget;
- maximum user message characters;
- maximum output tokens;
- default user daily request limit;
- default user daily token limit;
- default instance monthly request limit;
- default instance monthly token budget; and
- maximum concurrent generations.

Configuration parsing rejects unknown keys, invalid ranges, unsafe values, and
inconsistent budgets. The maximum output allowance must fit within the prompt
and provider request budget.

### 5.3 Database-backed operational settings

The first `db:deploy` after migration initializes the singleton operational
settings row from `app.config.yml`. Later deployments are idempotent and do not
overwrite administrator changes.

Administrators can:

- change global request and token limits;
- change instance concurrency;
- restore the current deployment defaults explicitly; and
- set or clear per-user daily request and token overrides.

Operational settings use a revision for optimistic concurrency. Updates are
audited atomically. Per-user overrides inherit each unspecified value from the
global user default and never bypass the instance budget.

## 6. Data Model

Names below describe required responsibilities. The implementation may use the
repository's normal singular Drizzle identifiers while retaining these
constraints.

### 6.1 Conversations

`conversations` stores:

- ID
- owning user ID
- stable character ID
- pinned immutable character-version ID
- lifecycle: `active` or `archived`
- created, updated, and last-message timestamps
- archived timestamp

Constraints:

- user deletion cascades to conversations;
- character and character-version references are restricted;
- the pinned version must belong to the referenced character;
- a partial unique index permits at most one active row for each
  `(user_id, character_id)` pair; and
- archived rows cannot return to active.

Character archival does not invalidate existing conversations. It prevents
new conversation creation and restart because those operations require an
active character with a selected default version.

### 6.2 Logical messages

`conversation_messages` stores the user-visible timeline:

- ID
- conversation ID
- strict sequence number
- role: `user` or `assistant`
- kind: `opening`, `user`, or `generated`
- content for opening and user messages
- optional user idempotency key
- optional `in_reply_to` user-message ID
- created timestamp

Constraints:

- `(conversation_id, sequence)` is unique;
- `(conversation_id, client_request_id)` is unique when a key exists;
- an opening message is assistant-authored, complete, and has persisted
  content;
- a user message is user-authored and has persisted content;
- a generated assistant slot has exactly one user message in the same
  conversation as its source; and
- each user message can have at most one generated assistant slot.

Generated content is read from the current generation attempt rather than
duplicated on the logical message.

### 6.3 Generation attempts

`generation_attempts` stores every provider-facing attempt:

- ID
- generated assistant-message ID
- monotonically increasing attempt number
- whether the attempt is the current visible attempt
- status: `pending`, `streaming`, `complete`, `interrupted`, or `failed`
- partial or final content
- actual model identifier
- provider request identifier when available
- normalized error category and retryability
- automatic provider-call retry count
- input and output token counts
- whether usage was provider-reported or estimated
- cancel-requested timestamp
- lease expiry and opaque lease owner
- started, first-token, checkpoint, and completed timestamps

Constraints:

- attempt numbers are unique per assistant message;
- exactly one attempt is current per assistant message;
- completed attempts cannot return to a nonterminal state;
- terminal attempt content and accounting fields are immutable; and
- ordinary timeline queries return only the current attempt.

A manual retry atomically clears the previous `is_current` flag, inserts the
next attempt as current, reserves quota, and acquires a lease. Prior attempts
remain available for accounting and debugging without producing duplicate
chat bubbles.

### 6.4 Quotas, reservations, and usage

The quota subsystem contains:

- one global chat-settings row;
- optional per-user overrides;
- daily user and monthly instance quota buckets;
- one active reservation per admitted user request;
- append-only usage ledger entries; and
- active generation leases.

Buckets maintain consumed and reserved request/token amounts for efficient,
transactional admission. The ledger remains the durable accounting source for
reconciliation and aggregate reports.

Every ledger entry identifies:

- user;
- conversation and attempt;
- UTC accounting period;
- user-request units;
- provider-call number;
- input and output tokens;
- provider-reported versus estimated usage;
- model identifier;
- normalized outcome; and
- timestamps.

The ledger never stores prompt or response text.

## 7. Conversation Lifecycle

### 7.1 Start or open

From a public character detail page, an authenticated user selects the chat
action.

The service:

1. locks the user-character active-conversation key;
2. returns the existing active conversation if one exists;
3. otherwise resolves the active character's current default published
   version;
4. creates a conversation pinned to that version; and
5. inserts the version's opening message as sequence one.

Concurrent starts return the same active conversation rather than creating
duplicates.

Anonymous users are redirected to sign-in and returned to the intended
character after successful authentication.

### 7.2 Restart

Restart requires confirmation and is unavailable while the user has an active
generation.

In one transaction, the service:

1. locks the current active conversation;
2. verifies the character is active and has a current default version;
3. archives the current conversation;
4. creates a new active conversation pinned to the current default version;
   and
5. persists the new version's opening message.

If any step fails, the original conversation remains active.

### 7.3 Archive access

Archived conversations:

- are visible in a history drawer;
- show their pinned version's character presentation;
- are read-only;
- cannot be restored; and
- can be permanently deleted.

The archive list contains dates and character-version presentation metadata,
not model-provider details.

### 7.4 Deletion

Users can permanently delete active or archived conversations they own.

Deletion cascades through logical messages, attempts, reservations, and leases.
Usage ledger rows retain their numeric accounting but set deleted conversation
and attempt references to null, so deleting a transcript does not restore
already consumed quota. Account deletion also sets the ledger user reference
to null. The remaining rows are de-identified aggregate accounting records;
they contain no prompt or response text.

Deletion and restart are rejected with an explicit generation-in-progress
error until the active attempt is stopped or reaches a terminal state.

## 8. Chat Request Flow

### 8.1 Admission

For a new user message:

1. authenticate with the authoritative session path;
2. validate conversation ownership and active lifecycle;
3. validate message length and non-empty normalized content;
4. use the idempotency key to return an existing turn if the browser retries
   the same submission;
5. reconcile expired leases;
6. reject if the user already owns an active generation lease;
7. select effective global and per-user limits;
8. estimate prompt input and reserve one user request plus the maximum possible
   token charge for this generation;
9. reject with a typed error if user quota, instance budget, or instance
   concurrency is exhausted;
10. persist the user message, assistant slot, initial attempt, reservation,
    and lease; and
11. commit before contacting the provider.

Failed admission does not persist a user message.

### 8.2 Prompt assembly

The prompt order is:

1. platform safety and behavioral rules;
2. the pinned published character definition and safety additions;
3. published example conversations that fit their assigned budget;
4. recent complete conversation turns;
5. the current user message.

User text is always sent as user-role content. It is never interpolated into
platform or character instructions.

The current user message, platform rules, and character definition are
mandatory. Recent history is selected newest-first by complete turn, then
restored to chronological order. The assembler removes oldest complete turns
until the estimated prompt fits. It never includes:

- non-current attempts;
- failed attempts;
- interrupted partial output;
- another conversation;
- another user;
- drafts or non-pinned character versions; or
- future Phase 4 memory placeholders.

The local tokenizer provides a consistent estimate for prompt selection and
reservation. Provider-reported usage is authoritative when available. Local
usage estimates use the same tokenizer plus a documented safety margin and
are explicitly marked as estimates.

### 8.3 Gateway request

The gateway maps the provider-independent request to an OpenAI-compatible
streaming chat-completions request using:

- the current configured model ID;
- character-version generation parameters bounded by deployment limits;
- the assembled messages;
- maximum output tokens; and
- streamed usage metadata when the provider supports it.

The gateway accepts standard server-sent `data:` frames and `[DONE]`, but emits
only the internal typed event contract.

### 8.4 Automatic retry

The gateway may perform at most one automatic retry when all are true:

- no output token has been emitted;
- the failure is transient;
- the request has not been cancelled; and
- enough timeout and lease duration remain.

Eligible failures are connection failures, first-token timeout, and provider
5xx responses. Provider authentication, validation, protocol errors, and
provider rate limits are not automatically retried unless an explicit bounded
`Retry-After` fits the same single-retry policy.

Once any output token is emitted, automatic retry is forbidden.

Automatic provider retries do not consume another user-request unit. Each
provider call and any known or estimated token usage is still recorded.

### 8.5 Streaming and checkpointing

The application:

1. emits `started`;
2. forwards normalized text deltas;
3. accumulates partial content;
4. checkpoints after approximately 500 milliseconds or 1 KiB of new text,
   whichever occurs first;
5. refreshes the lease while progress continues; and
6. emits a terminal event after settlement.

Checkpoint thresholds are implementation constants, not user-configurable
product settings. They may be tuned without changing the contract as long as
partial durability and database load remain tested.

### 8.6 Stop and disconnect

The UI provides an explicit stop action. Stop:

- records a cancel request in PostgreSQL;
- aborts the local provider request when the serving process owns it;
- is observed between provider chunks even when another process owns it;
- flushes the latest partial content;
- marks the attempt `interrupted`; and
- settles known or estimated usage.

A browser disconnect also aborts the request when observable. If the process
dies before settlement, lease expiry provides deterministic recovery.

Phase 3 does not resume a byte stream after page reload. The page displays the
persisted partial reply as interrupted and offers manual retry.

### 8.7 Completion and failure

Completion atomically:

- stores final content and terminal timestamps;
- stores provider-reported or estimated usage;
- appends ledger entries;
- converts the reservation to consumed usage;
- releases unused reserved tokens;
- releases the generation lease; and
- emits `completed`.

Failure atomically:

- preserves any checkpointed content;
- stores a normalized error category;
- records retryability and operational metadata;
- consumes the user request;
- settles known or estimated provider token usage;
- releases remaining reservations and the lease; and
- emits `failed` or `interrupted`.

## 9. Quota and Concurrency Rules

### 9.1 User quota

Each user has:

- a UTC daily user-request limit; and
- a UTC daily total-token limit.

A new message and a manual retry each consume one user-request unit after
admission. Automatic provider retries do not.

Per-user overrides may independently replace the request or token limit.
Missing override fields inherit the global default.

### 9.2 Instance budget

The instance has:

- a UTC monthly user-request budget;
- a UTC monthly token budget; and
- a maximum active-generation count.

Every admitted user request consumes instance request capacity. Every provider
call contributes provider-reported or estimated tokens. The instance budget
applies even when a user has a larger override.

### 9.3 Reservation

Admission reserves:

- one user and instance request unit;
- estimated prompt input tokens;
- maximum configured output tokens; and
- one active generation slot.

Row locks and a consistent lock order prevent oversubscription and deadlock:

1. global settings;
2. instance bucket;
3. user bucket;
4. user lease key; and
5. conversation.

The implementation must exercise this order in concurrent PostgreSQL tests.

Mutations requiring both global settings and user-row authorization locks,
including administrator settings writes and disablement, acquire settings
first and recheck authorization inside the transaction. Checkpoints and
settlement lock an attempt before its lease; expiry reconciliation rereads
the lease after both locks so concurrent refreshes cannot be treated as expired.

At settlement, actual usage replaces reserved usage. Failed requests retain
their consumed request unit. Unused token reservation is released.

### 9.4 Typed limit errors

Limit errors contain:

- stable machine code;
- whether retry is possible;
- UTC reset timestamp when applicable; and
- privacy-safe display metadata.

Codes distinguish:

- user request quota;
- user token quota;
- instance request budget;
- instance token budget;
- user generation already in progress; and
- instance concurrency exhausted.

The application does not silently switch models, queue an unbounded request,
or return a success-shaped fallback.

## 10. Model Gateway Errors

Normalized categories are:

- provider authentication;
- provider rate limit;
- first-token timeout;
- total timeout;
- provider connection;
- provider server failure;
- provider protocol failure;
- user cancellation;
- stream interruption; and
- invalid deployment configuration.

Provider error bodies are not passed to the browser or normal logs. The
gateway records only safe status, category, provider request ID, latency,
retry count, model ID, and token usage.

Each category maps to a stable UI state and retryability rule. Authentication
and invalid-configuration failures tell the user to contact the deployer.
Rate limits and transient outages offer retry. Interrupted streams preserve
partial output and offer manual retry.

## 11. User Experience

### 11.1 Routes

- `/app` lists current active chats by character and links to the character
  catalog.
- `/app/conversations/<id>` is the focused active chat screen.
- Archived conversations reuse the conversation route in read-only mode and
  enforce the same ownership query.
- Character detail pages provide the authenticated start/open action.

### 11.2 Focused chat layout

The chat header contains:

- character avatar and display name;
- generation or availability status;
- a history action; and
- an overflow action for restart and deletion.

The main area contains the message timeline. The composer remains at the
bottom. During generation, send changes to stop. The application prevents a
second submission while the current user owns a lease.

When another tab attempts to generate, it receives a generation-in-progress
state with a link to the owning conversation.

### 11.3 Version presentation

The ordinary UI does not require users to understand version numbers. If the
active conversation's pinned version is no longer the character default, the
UI may show:

> This conversation keeps the character version it started with. Start over
> to use the current version.

Restart remains an explicit, confirmed action because it archives the active
transcript.

### 11.4 Message states

Generated assistant messages visibly distinguish:

- waiting;
- streaming;
- complete;
- stopped;
- interrupted;
- timed out;
- rate limited; and
- failed.

Failure is never rendered as a normal completed assistant answer.

Manual retry is available only for failed or interrupted current attempts.
It replaces the visible bubble when admitted, while internal attempt history
remains intact.

### 11.5 Safe Markdown

Supported rendering includes:

- paragraphs and line breaks;
- emphasis;
- ordered and unordered lists;
- blockquotes;
- inline code and fenced code blocks; and
- safe links.

Raw HTML is disabled. Images and automatic embeds are disabled. Link protocols
are allowlisted, and external links use `noopener noreferrer`. Markdown
rendering must not enable script execution or copy provider metadata into the
document.

## 12. Administration

### 12.1 Global usage page

`/admin/usage` displays aggregate operational data:

- current user-day and instance-month request totals;
- input, output, and total tokens;
- active generation slots;
- success, failure, and interruption counts;
- provider failures grouped by normalized category;
- automatic retry counts;
- estimated-versus-provider-reported usage; and
- latency distributions.

It may display the configured model identifier. It never displays the API key,
provider request body, prompt, response text, or per-conversation transcript.

### 12.2 Settings

The usage administration surface includes global limits and concurrency
settings. Updates:

- require current administrator authorization inside the write transaction;
- use optimistic revision checks;
- validate safe ranges and cross-field consistency;
- take effect for new admissions;
- do not cancel already admitted generations; and
- write a privacy-safe administrative audit event.

### 12.3 Per-user overrides

The existing user administration flow can set or clear daily request and token
overrides for ordinary users. It shows limits and aggregate current-period
usage, not message content.

Audit metadata includes changed field names and old/new numeric values. It does
not contain messages, prompts, provider bodies, or credentials.

## 13. Privacy, Authorization, and Deletion

Every conversation, message, attempt, retry, stop, archive read, and deletion
query includes the authenticated user ID. Knowledge of an ID is never
sufficient authorization.

The application must test that:

- user A cannot read, stream, retry, stop, restart, archive, or delete user B's
  resources;
- administrators cannot use normal administration routes to read private
  content;
- logs and audit events omit content;
- provider credentials never enter client components, browser responses, or
  static assets; and
- account deletion removes all conversation content and anonymizes retained
  numeric usage ledger rows by clearing user, conversation, and attempt
  references.

Model input necessarily contains the messages selected for the current model
request. The README must state that self-hosters are responsible for the
privacy terms of their configured model provider.

## 14. Health and Observability

Startup validates model configuration syntax and required values.

Readiness reports whether chat is correctly configured without making a model
request for every health probe. A temporary provider outage degrades chat but
does not make authentication, character browsing, account management, or
administration unavailable.

Operational logs include:

- request, user, conversation, and attempt IDs;
- normalized event and error categories;
- latency;
- retry count;
- model identifier;
- token usage; and
- estimated-usage indicator.

They exclude message content, assembled prompts, API keys, provider response
bodies, cookies, and tokens.

## 15. Testing Strategy

### 15.1 Unit tests

- strict public and secret configuration
- configuration cross-field validation
- prompt precedence
- character-version selection
- complete-turn recent-history selection
- token budget trimming
- token estimation and safety margin
- gateway request mapping
- SSE parsing and NDJSON event encoding
- error normalization and retryability
- first-token retry boundary
- quota period and effective-limit calculations
- typed error serialization
- safe Markdown component restrictions

### 15.2 PostgreSQL integration tests

- concurrent start creates one active conversation
- user-character partial unique constraint
- pinned version belongs to the character
- restart archives old and creates new atomically
- archived conversations cannot be restored or written
- archived character permits existing chat but prevents start/restart
- strict cross-user isolation for every operation
- idempotency key prevents duplicate turns and quota charges
- one active generation lease per user
- global concurrency admission under race
- user and instance reservation under race
- lock order does not deadlock
- quota settlement releases unused reservation
- expired lease becomes interrupted
- retry preserves prior attempts and selects one current attempt
- account and conversation deletion behavior
- aggregate usage omits content
- administrator setting and override authorization/audit

### 15.3 Model gateway contract tests

A local fake OpenAI-compatible server covers:

- normal incremental output;
- provider-reported usage;
- missing usage and local estimation;
- provider request IDs;
- authentication failure;
- rate limiting and `Retry-After`;
- server errors;
- failure before the first token;
- timeout before the first token;
- disconnect after partial output;
- malformed stream frames;
- missing `[DONE]`;
- explicit cancellation; and
- the prohibition on automatic retry after output begins.

### 15.4 Browser acceptance tests

1. A verified user starts a character conversation and sees the persisted
   opening message without a model call.
2. The user sends a message and sees streamed partial output become complete.
3. The user stops output and sees retained partial text marked interrupted.
4. A manual retry replaces the visible interrupted bubble and retains usage
   accounting for both attempts.
5. Refresh during or after an abandoned stream yields an explicit interrupted
   state, not a false success.
6. User quota and instance budget exhaustion show distinct reset information.
7. A second generation from another tab is rejected and links to the active
   generation.
8. Archived history is read-only, cannot be restored, and can be deleted.
9. Active conversation deletion removes its transcript.
10. Two users chatting with the same character cannot observe each other's
    conversations, events, IDs, or usage.
11. An administrator publishes and selects character v2. The existing active
    conversation remains pinned to v1. Restart archives it and creates a new
    active conversation pinned to v2.
12. The usage administration page reports aggregate results while neither it,
    logs, nor audit metadata contain test message text.
13. Browser assets and responses contain no provider key or endpoint secret.

## 16. Release Gate

Phase 3 is complete only when:

- all unit and PostgreSQL integration tests pass;
- fake-provider contract tests pass;
- all browser acceptance scenarios pass;
- TypeScript 7 type checking passes;
- lint has no errors;
- the production build passes its TypeScript 7 preflight;
- Drizzle reports no schema drift;
- Docker Compose deployment documentation includes model and quota setup;
- the repository remains deployable with app, worker, and PostgreSQL only; and
- an independent code review finds no unresolved critical or important issue.

## 17. Expected File and Module Boundaries

The implementation plan should preserve small, independently testable units:

- `src/server/db/chat-schema.ts`
- `src/server/chat/conversation-service.ts`
- `src/server/chat/conversation-queries.ts`
- `src/server/chat/prompt-assembler.ts`
- `src/server/chat/token-counter.ts`
- `src/server/chat/quota-service.ts`
- `src/server/chat/generation-service.ts`
- `src/server/model-gateway/openai-compatible-gateway.ts`
- `src/server/model-gateway/stream-parser.ts`
- `src/server/model-gateway/model-error.ts`
- `src/app/api/chat/...`
- `src/app/app/conversations/...`
- `src/components/chat/...`
- `src/server/admin/usage-queries.ts`
- `src/server/admin/chat-settings-service.ts`

These names are guidance, not permission to combine unrelated responsibilities.
The implementation plan must identify prior repository patterns to reuse,
including authoritative session checks, transactional administrator
authorization, privacy-safe audit events, strict runtime configuration, and
real PostgreSQL concurrency tests.
