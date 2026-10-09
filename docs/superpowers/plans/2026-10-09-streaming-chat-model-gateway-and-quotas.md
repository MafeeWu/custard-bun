# Streaming Chat, Model Gateway, and Quotas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver private, version-pinned, streaming character conversations with an OpenAI-compatible server-only model gateway, durable incomplete states, transactional request/token quotas, and privacy-safe aggregate administration.

**Architecture:** Extend the existing Next.js modular monolith with PostgreSQL-backed conversation, attempt, lease, reservation, and usage-ledger domains. Admit each generation in a short transaction, stream directly from the app process through a provider-independent gateway, checkpoint partial output, and settle quota in a terminal transaction; keep the existing worker out of the interactive path.

**Tech Stack:** Node.js 24.x, pnpm 12.5.1, Next.js 16.3.6, React 19.3.0, TypeScript 7.0.2 compiler with the official TypeScript 6 API compatibility package, Better Auth 1.7.5, Drizzle ORM 0.45.3, PostgreSQL 16, Zod 4.6.5, Vitest 5.0.1, Testing Library 16.3.3, Playwright 1.63.0, `js-tiktoken`, and `react-markdown`.

**Spec:** `docs/superpowers/specs/2026-10-09-streaming-chat-model-gateway-and-quotas-design.md`

## Global Constraints

- Keep the application a TypeScript/Next.js modular monolith with PostgreSQL as
  its only required stateful production dependency.
- Keep the TypeScript 7 compiler plus official TypeScript 6 API compatibility
  split: `pnpm exec tsc --version` remains 7.0.2, importing `typescript`
  exposes the TypeScript 6.0.3 API, and `pnpm build` runs `pnpm typecheck`
  before `next build`.
- Provider credentials stay server-only. Browser code, responses, logs, audit
  events, and static assets must not contain the API key or raw provider body.
- A user has at most one active conversation per character and at most one
  active generation across all characters.
- A conversation permanently pins one immutable character version. Existing
  conversations remain usable after character archival; new or restarted
  conversations require an active character with a selected default version.
- Restart archives the current conversation and creates a new one. Archived
  conversations are read-only and cannot be restored.
- The published opening message is persisted without a model call.
- User quota periods are UTC calendar days. Instance budget periods are UTC
  calendar months. Both request and token limits are enforced transactionally.
- Automatic retry is allowed at most once and only before the first output token.
  Manual retry is limited to failed or interrupted current attempts.
- Phase 3 uses recent complete turns only. Do not add memory, summaries,
  embeddings, multi-model routing, billing, voice, images, RAG, plugins, or
  user-created characters.
- Administrators receive aggregate usage and provider-failure data only. No
  normal administration path may read prompts, messages, or partial output.
- Preserve authoritative session validation, in-transaction administrator
  reauthorization, privacy-safe audit metadata, loopback `_test` database
  protection, and real PostgreSQL concurrency tests.

## Review Focus

- A browser retry after losing the first response must reuse the idempotency key
  without duplicating a user message, assistant slot, request charge, or model
  call; cover this in Task 7 route and integration tests.
- A process crash after quota reservation but before terminal settlement must
  turn the attempt into `interrupted`, release its lease and unused token
  reservation exactly once, and preserve its last checkpoint; cover this in
  Tasks 6 and 7.
- Concurrent requests for the final quota or concurrency slot must admit only
  one request without oversubscription or deadlock; cover this in Task 6 with
  two database connections and observed lock contention.
- Missing usage, malformed stream frames, delayed first tokens, provider 429,
  and disconnect after a delta must produce the documented accounting and
  retry behavior; cover this in Task 5 fake-provider contract tests.
- Restart, deletion, account deletion, or administrator disablement racing an
  active generation must never leave an orphan lease, mutable archived thread,
  cross-user response, or restored quota; cover this in Tasks 3, 6, 7, and 10.

---

## File Structure

Create and modify these focused units:

```text
src/server/config/
├── schema.ts
├── runtime-config-core.ts
└── chat-config.test.ts

src/server/db/
├── chat-schema.ts
├── chat-schema.integration.test.ts
├── audit-schema.ts
├── seed-chat-settings.ts
└── schema.ts

src/server/chat/
├── chat-errors.ts
├── chat-events.ts
├── chat-locks.ts
├── token-counter.ts
├── token-counter.test.ts
├── prompt-assembler.ts
├── prompt-assembler.test.ts
├── conversation-service.ts
├── conversation-service.integration.test.ts
├── conversation-queries.ts
├── conversation-queries.integration.test.ts
├── quota-service.ts
├── quota-service.integration.test.ts
├── generation-service.ts
├── generation-service.integration.test.ts
├── chat-settings-seed.ts
└── chat-settings-seed.integration.test.ts

src/server/model-gateway/
├── model-contract.ts
├── model-error.ts
├── stream-parser.ts
├── stream-parser.test.ts
├── openai-compatible-gateway.ts
└── openai-compatible-gateway.integration.test.ts

src/app/api/chat/
├── conversations/[id]/messages/route.ts
├── conversations/[id]/messages/route.test.ts
└── attempts/[id]/stop/route.ts

src/app/app/
├── page.tsx
├── page.test.tsx
├── conversations/[id]/page.tsx
├── conversations/[id]/page.test.tsx
└── conversations/actions.ts

src/components/chat/
├── chat-screen.tsx
├── chat-composer.tsx
├── chat-timeline.tsx
├── chat-message.tsx
├── safe-markdown.tsx
├── conversation-history.tsx
└── *.test.tsx

src/server/admin/
├── chat-settings-service.ts
├── chat-settings-service.integration.test.ts
├── usage-queries.ts
├── usage-queries.integration.test.ts
├── user-service.ts
└── user-service.integration.test.ts

src/app/admin/
├── layout.tsx
├── usage/page.tsx
├── usage/page.test.tsx
├── usage/actions.ts
├── users/page.tsx
└── users/actions.ts

tests/e2e/
├── chat.spec.ts
├── chat-quotas.spec.ts
├── support/fake-model-server.ts
└── support/environment.ts

drizzle/
├── 0005_streaming_chat.sql
└── meta/
```

Also modify `package.json`, `pnpm-lock.yaml`, `app.config.yml`,
`.env.example`, `playwright.config.ts`, `README.md`, the delivery roadmap,
Docker/Compose environment wiring, and database deployment scripts.

### Task 1: Define Chat Configuration, Contracts, and Token Counting

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `src/server/config/schema.ts`
- Modify: `src/server/config/runtime-config-core.ts`
- Modify: `src/server/config/load-config.test.ts`
- Modify: `src/test/unit/runtime-config-fixture.ts`
- Create: `src/server/config/chat-config.test.ts`
- Create: `src/server/chat/chat-errors.ts`
- Create: `src/server/chat/chat-events.ts`
- Create: `src/server/chat/token-counter.ts`
- Create: `src/server/chat/token-counter.test.ts`
- Modify: `app.config.yml`
- Modify: `.env.example`

**Interfaces:**

- Consumes: existing strict runtime configuration and Zod formatting.
- Produces:
  - `ChatDeploymentConfig`
  - `ModelSecretConfig`
  - `ChatDomainError`
  - `ChatErrorCode`
  - `ChatStreamEvent`
  - `TokenCounter`
  - `createTokenCounter(modelId: string): TokenCounter`

- [ ] **Step 1: Install the tokenizer dependency**

Run:

```bash
pnpm add --save-exact js-tiktoken
```

Expected: `package.json` and `pnpm-lock.yaml` contain one exact
`js-tiktoken` dependency; the TypeScript compiler aliases remain unchanged.

- [ ] **Step 2: Write failing strict-configuration tests**

Add `chat` to `validYaml` and model variables to `validSecretEnv`:

```ts
chat:
  firstTokenTimeoutMs: 30000
  requestTimeoutMs: 120000
  promptTokenBudget: 8192
  maxInputCharacters: 12000
  maxOutputTokens: 1024
  defaultUserDailyRequestLimit: 100
  defaultUserDailyTokenLimit: 100000
  defaultInstanceMonthlyRequestLimit: 10000
  defaultInstanceMonthlyTokenBudget: 10000000
  maxConcurrentGenerations: 4
```

```ts
MODEL_API_BASE_URL: "http://127.0.0.1:3102/v1",
MODEL_API_KEY: "test-model-key",
MODEL_ID: "test-chat-model",
```

Test valid parsing and reject:

```ts
test.each([
  ["unknown chat key", "chat:\\n  unknown: true"],
  ["zero first-token timeout", "firstTokenTimeoutMs: 0"],
  ["total timeout below first-token timeout", "requestTimeoutMs: 1000"],
  ["output larger than prompt budget", "maxOutputTokens: 9000"],
  ["zero request limit", "defaultUserDailyRequestLimit: 0"],
  ["zero monthly token budget", "defaultInstanceMonthlyTokenBudget: 0"],
  ["zero concurrency", "maxConcurrentGenerations: 0"],
])("rejects %s", async (_title, replacement) => {
  await expect(loadRuntimeConfig(fixtureWith(replacement))).rejects.toThrow();
});
```

Also reject missing model variables, non-HTTP(S) base URLs, an empty model ID,
and an API key shorter than eight characters.

- [ ] **Step 3: Run configuration tests to verify failure**

Run:

```bash
pnpm vitest run src/server/config/load-config.test.ts src/server/config/chat-config.test.ts
```

Expected: FAIL because the chat and model schemas do not exist.

- [ ] **Step 4: Implement strict chat and model configuration**

Extend the public schema with:

```ts
const chatConfigSchema = z
  .object({
    firstTokenTimeoutMs: z.number().int().min(1_000).max(120_000),
    requestTimeoutMs: z.number().int().min(1_000).max(600_000),
    promptTokenBudget: z.number().int().min(512).max(1_000_000),
    maxInputCharacters: z.number().int().min(1).max(1_000_000),
    maxOutputTokens: z.number().int().min(1).max(100_000),
    defaultUserDailyRequestLimit: z.number().int().min(1),
    defaultUserDailyTokenLimit: z.number().int().min(1),
    defaultInstanceMonthlyRequestLimit: z.number().int().min(1),
    defaultInstanceMonthlyTokenBudget: z.number().int().min(1),
    maxConcurrentGenerations: z.number().int().min(1).max(1_000),
  })
  .strict()
  .refine((value) => value.requestTimeoutMs >= value.firstTokenTimeoutMs, {
    message: "request timeout must be at least the first-token timeout",
  })
  .refine((value) => value.maxOutputTokens < value.promptTokenBudget, {
    message: "max output tokens must be below the prompt token budget",
  });
```

Add `MODEL_API_BASE_URL`, `MODEL_API_KEY`, and `MODEL_ID` to the secret schema.
Map them into:

```ts
model: {
  apiBaseUrl: string;
  apiKey: string;
  modelId: string;
}
```

Update `app.config.yml` and `.env.example` with deployable examples.

- [ ] **Step 5: Write failing error/event/token tests**

Define exact event expectations:

```ts
const events: ChatStreamEvent[] = [
  { type: "started", attemptId: "attempt-1" },
  { type: "delta", attemptId: "attempt-1", text: "Hello" },
  {
    type: "completed",
    attemptId: "attempt-1",
    usage: { inputTokens: 12, outputTokens: 3, estimated: false },
  },
];
expect(events.map((event) => event.type)).toEqual([
  "started",
  "delta",
  "completed",
]);
```

Test `ChatDomainError` serializes stable codes and safe metadata. Test the token
counter counts empty text as zero, Chinese and emoji as nonzero, counts message
role overhead consistently, and applies a 20% fallback-accounting safety
margin:

```ts
expect(counter.estimateText("")).toBe(0);
expect(counter.estimateText("你好 👋")).toBeGreaterThan(0);
expect(counter.withSafetyMargin(100)).toBe(120);
```

- [ ] **Step 6: Run contract tests to verify failure**

Run:

```bash
pnpm vitest run src/server/chat/token-counter.test.ts
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 7: Implement shared contracts and tokenizer**

Use these stable error codes:

```ts
export type ChatErrorCode =
  | "CHAT_VALIDATION"
  | "CHAT_NOT_FOUND"
  | "CHAT_READ_ONLY"
  | "CHAT_GENERATION_IN_PROGRESS"
  | "CHAT_USER_REQUEST_QUOTA"
  | "CHAT_USER_TOKEN_QUOTA"
  | "CHAT_INSTANCE_REQUEST_BUDGET"
  | "CHAT_INSTANCE_TOKEN_BUDGET"
  | "CHAT_INSTANCE_CONCURRENCY"
  | "CHAT_PROVIDER_AUTH"
  | "CHAT_PROVIDER_RATE_LIMIT"
  | "CHAT_PROVIDER_TIMEOUT"
  | "CHAT_PROVIDER_PROTOCOL"
  | "CHAT_STREAM_INTERRUPTED"
  | "CHAT_INTERNAL";
```

Define `ChatStreamEvent` as a discriminated union. `failed` and `interrupted`
events contain only `code`, `message`, `retryable`, and optional `resetAt`.

Implement `TokenCounter` with `js-tiktoken`'s `cl100k_base` encoding:

```ts
export interface TokenCounter {
  estimateText(value: string): number;
  estimateMessages(
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  ): number;
  withSafetyMargin(tokens: number): number;
  free(): void;
}
```

Always release the encoding in tests and short-lived scripts.

- [ ] **Step 8: Run Task 1 tests**

Run:

```bash
pnpm vitest run src/server/config/load-config.test.ts src/server/config/chat-config.test.ts src/server/chat/token-counter.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit Task 1**

```bash
git add package.json pnpm-lock.yaml app.config.yml .env.example src/server/config src/server/chat/chat-errors.ts src/server/chat/chat-events.ts src/server/chat/token-counter.ts src/server/chat/token-counter.test.ts src/test/unit/runtime-config-fixture.ts
git commit -m "feat(chat): add model and quota configuration"
```

### Task 2: Add Chat Storage, Invariants, and Settings Bootstrap

**Files:**

- Create: `src/server/db/chat-schema.ts`
- Create: `src/server/db/chat-schema.integration.test.ts`
- Modify: `src/server/db/schema.ts`
- Modify: `src/server/db/audit-schema.ts`
- Create: `src/server/chat/chat-settings-seed.ts`
- Create: `src/server/chat/chat-settings-seed.integration.test.ts`
- Modify: `src/server/db/migrate.ts`
- Create: `src/server/db/seed-chat-settings.ts`
- Modify: `package.json`
- Create: `drizzle/0005_streaming_chat.sql`
- Modify: `drizzle/meta/_journal.json`
- Create/modify: generated `drizzle/meta/0005_snapshot.json`

**Interfaces:**

- Consumes: Task 1 configuration types and existing auth, character, and audit
  schemas.
- Produces:
  - Drizzle tables `conversation`, `conversationMessage`,
    `generationAttempt`, `chatSettings`, `userChatQuotaOverride`,
    `quotaBucket`, `quotaReservation`, `usageLedger`, and `generationLease`
  - chat lifecycle/status enums
  - `seedChatSettings(database, config): Promise<"created" | "existing">`

- [ ] **Step 1: Write failing schema invariant tests**

Use the real test database. Prove:

```ts
await expectDatabaseError(
  database.insert(conversation).values(secondActiveConversation),
  /one active conversation/i,
);

await expectDatabaseError(
  database.update(conversation)
    .set({ lifecycle: "active" })
    .where(eq(conversation.id, archivedId)),
  /archived conversations cannot be restored/i,
);

await expectDatabaseError(
  database.insert(conversation).values({
    ...conversationValues,
    characterId: firstCharacterId,
    characterVersionId: secondCharacterVersionId,
  }),
  /pinned version must belong/i,
);
```

Also test:

- duplicate message sequence and client request ID fail;
- generated assistant slots reference one user message in the same conversation;
- one current attempt per assistant slot;
- one active lease per user;
- terminal attempt status, content, and accounting fields cannot be mutated;
- deleting a conversation removes content but nulls ledger conversation and
  attempt references;
- deleting a user nulls ledger user references; and
- quota bucket scope/period constraints reject malformed rows.

- [ ] **Step 2: Run schema tests to verify failure**

Run:

```bash
pnpm db:test:up
pnpm vitest run src/server/db/chat-schema.integration.test.ts
```

Expected: FAIL because the tables do not exist.

- [ ] **Step 3: Define Drizzle tables and indexes**

Use exact enum values:

```ts
export const conversationLifecycleEnum = pgEnum("conversation_lifecycle", [
  "active",
  "archived",
]);
export const messageKindEnum = pgEnum("conversation_message_kind", [
  "opening",
  "user",
  "generated",
]);
export const generationStatusEnum = pgEnum("generation_status", [
  "pending",
  "streaming",
  "complete",
  "interrupted",
  "failed",
]);
export const quotaScopeEnum = pgEnum("quota_scope", ["user", "instance"]);
export const reservationStatusEnum = pgEnum("quota_reservation_status", [
  "active",
  "settled",
  "released",
]);
```

Use PostgreSQL `bigint` with `{ mode: "number" }` for request/token counters and
guard values with nonnegative checks. Use a composite foreign key from
`(character_id, character_version_id)` to
`character_versions(character_id, id)`.

Create partial unique indexes for:

```sql
UNIQUE (user_id, character_id) WHERE lifecycle = 'active'
UNIQUE (assistant_message_id) WHERE is_current
UNIQUE (user_id) ON generation_leases
```

Use `ON DELETE SET NULL` for ledger user, conversation, and attempt references.
Do not put message text in quota or usage tables.

- [ ] **Step 4: Generate and harden the migration**

Run:

```bash
pnpm db:generate
```

Rename the generated migration to `0005_streaming_chat.sql` if needed. Add
database triggers for:

- archived conversation lifecycle immutability;
- terminal generation-attempt update immutability while allowing
  conversation/account deletion cascades;
- conversation-version ownership if the generated composite FK is incomplete;
- generated-message `in_reply_to` ownership and kind validation; and
- lease/reservation cleanup constraints that cannot be expressed by Drizzle.

Extend `admin_audit_action` with:

```text
chat.settings.update
chat.settings.reset
user.chat_quota.update
user.chat_quota.clear
```

- [ ] **Step 5: Apply migration and rerun invariant tests**

Run:

```bash
pnpm db:migrate
pnpm vitest run src/server/db/chat-schema.integration.test.ts
```

Expected: PASS.

- [ ] **Step 6: Write failing settings-bootstrap tests**

Test first seed creates the singleton from `config.public.chat`, second seed
returns `existing`, and a second deployment does not overwrite administrator
changes:

```ts
expect(await seedChatSettings(database, runtimeConfig.public.chat)).toBe(
  "created",
);
await database.update(chatSettings).set({ userDailyRequestLimit: 7 });
expect(await seedChatSettings(database, runtimeConfig.public.chat)).toBe(
  "existing",
);
expect(await readSettings()).toMatchObject({ userDailyRequestLimit: 7 });
```

- [ ] **Step 7: Implement idempotent settings bootstrap**

Create a singleton row with ID `"global"` and revision `1` using
`ON CONFLICT DO NOTHING`. Store deployment defaults alongside current values so
the reset action can restore the latest explicit `db:deploy` defaults without
silently replacing current operational values.

Add:

```json
"db:seed:chat-settings": "node --env-file-if-exists=.env --import tsx src/server/db/seed-chat-settings.ts"
```

Create `src/server/db/seed-chat-settings.ts`, and change `db:deploy` to:

```json
"db:deploy": "pnpm db:migrate && pnpm db:seed:characters && pnpm db:seed:chat-settings"
```

- [ ] **Step 8: Run Task 2 tests and drift check**

Run:

```bash
pnpm vitest run src/server/db/chat-schema.integration.test.ts src/server/chat/chat-settings-seed.integration.test.ts
pnpm db:generate
git diff --exit-code -- drizzle
```

Expected: tests PASS and no new migration is generated.

- [ ] **Step 9: Commit Task 2**

```bash
git add package.json src/server/db src/server/chat/chat-settings-seed.ts src/server/chat/chat-settings-seed.integration.test.ts drizzle
git commit -m "feat(chat): add conversation and usage storage"
```

### Task 3: Implement Conversation Lifecycle and Ownership Queries

**Files:**

- Create: `src/server/chat/conversation-service.ts`
- Create: `src/server/chat/conversation-service.integration.test.ts`
- Create: `src/server/chat/conversation-queries.ts`
- Create: `src/server/chat/conversation-queries.integration.test.ts`
- Create: `src/server/chat/chat-locks.ts`
- Create: `src/server/chat/chat-locks.integration.test.ts`

**Interfaces:**

- Consumes: Task 2 schema and existing
  `resolveDefaultCharacterVersion`/`getPublishedCharacterVersion`.
- Produces:

```ts
export interface ConversationService {
  openOrCreate(input: {
    userId: string;
    characterId: string;
  }): Promise<{ conversationId: string; created: boolean }>;
  restart(input: {
    userId: string;
    conversationId: string;
  }): Promise<{ conversationId: string }>;
  delete(input: {
    userId: string;
    conversationId: string;
  }): Promise<void>;
}

export function getConversationForUser(
  database: Database,
  input: { userId: string; conversationId: string },
): Promise<UserConversationDetail | null>;

export function listActiveConversations(
  database: Database,
  userId: string,
): Promise<ActiveConversationSummary[]>;

export function listArchivedCharacterConversations(
  database: Database,
  input: { userId: string; characterId: string },
): Promise<ArchivedConversationSummary[]>;

export type ChatTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];

export async function lockUserChatMutation(
  transaction: ChatTransaction,
  userId: string,
): Promise<void>;
```

- [ ] **Step 1: Write failing lifecycle tests**

Test:

- first open creates active conversation pinned to the current default and one
  opening message;
- second open returns the same conversation without another opening;
- two concurrent opens return one ID;
- changing the default does not change the existing pinned version;
- archived character permits reading and continuing an existing active
  conversation but rejects first open and restart;
- restart atomically archives the current thread and creates a new thread with
  the new default/opening;
- restart failure leaves the original active;
- archived rows are read-only and never restored;
- delete active or archived removes content but does not reduce consumed quota;
- restart/delete reject an active lease; and
- restart/delete racing admission follow one lock order and do not deadlock; and
- user A receives `null`/not-found for every user B conversation query.

The version-pinning assertion must compare IDs:

```ts
expect(await getConversationVersion(oldConversationId)).toBe(v1.id);
await selectDefaultVersion(v2.id);
expect(await getConversationVersion(oldConversationId)).toBe(v1.id);
expect(await getConversationVersion(restartedId)).toBe(v2.id);
```

- [ ] **Step 2: Run lifecycle tests to verify failure**

Run:

```bash
pnpm vitest run src/server/chat/conversation-service.integration.test.ts src/server/chat/conversation-queries.integration.test.ts
```

Expected: FAIL because the services do not exist.

- [ ] **Step 3: Implement ownership-safe queries**

Every detail/history query includes `eq(conversation.userId, userId)`. Return a
view model containing pinned character-version presentation and current attempt
only:

```ts
export interface UserConversationDetail {
  id: string;
  lifecycle: "active" | "archived";
  character: {
    id: string;
    slug: string;
    displayName: string;
    avatarPath: string;
    pinnedVersionId: string;
    isCurrentDefault: boolean;
  };
  messages: Array<
    | { id: string; role: "user"; kind: "user"; content: string }
    | { id: string; role: "assistant"; kind: "opening"; content: string }
    | {
        id: string;
        role: "assistant";
        kind: "generated";
        attemptId: string;
        status: GenerationStatus;
        content: string;
        errorCode: ChatErrorCode | null;
        retryable: boolean;
      }
  >;
}
```

Do not expose non-current attempts to ordinary query callers.

- [ ] **Step 4: Implement transactional lifecycle service**

`lockUserChatMutation` first locks the singleton `chat_settings` row, then takes
a transaction-scoped PostgreSQL advisory lock derived from the user ID. Every
restart, delete, account-sensitive chat mutation, and Task 6 admission uses
this helper before locking a conversation row.

Use an additional transaction-scoped advisory lock derived from
`userId + characterId` before open/restart. Insert the opening message from the
pinned immutable version. Check active leases before restart/delete and throw:

```ts
throw new ChatDomainError(
  "CHAT_GENERATION_IN_PROGRESS",
  "Stop the current reply before changing this conversation.",
  { retryable: true },
);
```

Map unique-active races by re-reading and returning the winning row.

- [ ] **Step 5: Run Task 3 tests**

Run:

```bash
pnpm vitest run src/server/chat/chat-locks.integration.test.ts src/server/chat/conversation-service.integration.test.ts src/server/chat/conversation-queries.integration.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add src/server/chat/chat-locks.ts src/server/chat/chat-locks.integration.test.ts src/server/chat/conversation-service.ts src/server/chat/conversation-service.integration.test.ts src/server/chat/conversation-queries.ts src/server/chat/conversation-queries.integration.test.ts
git commit -m "feat(chat): add version-pinned conversation lifecycle"
```

### Task 4: Assemble Prompts Within Explicit Token Budgets

**Files:**

- Create: `src/server/chat/prompt-assembler.ts`
- Create: `src/server/chat/prompt-assembler.test.ts`
- Modify: `src/server/characters/character-queries.ts`
- Modify: `src/server/characters/character-content.ts` only if a reusable
  exported character prompt projection is required.

**Interfaces:**

- Consumes: the exported `PublishedCharacterVersion`, `TokenCounter`, and
  complete timeline messages.
- Produces:

```ts
export type GatewayMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export function assembleChatPrompt(input: {
  character: PublishedCharacterVersion;
  history: PromptHistoryMessage[];
  currentUserMessage: string;
  platformRules: string;
  promptTokenBudget: number;
  maxOutputTokens: number;
  tokenCounter: TokenCounter;
}): {
  messages: GatewayMessage[];
  estimatedInputTokens: number;
  includedHistoryMessageIds: string[];
};
```

- [ ] **Step 1: Write failing precedence and trimming tests**

Assert the exact order:

```ts
expect(result.messages.map((message) => message.role)).toEqual([
  "system",
  "system",
  "user",
  "assistant",
  "user",
]);
expect(result.messages[0]!.content).toContain("Platform rules");
expect(result.messages[1]!.content).toContain(character.displayName);
expect(result.messages.at(-1)).toEqual({
  role: "user",
  content: currentMessage,
});
```

Use a deterministic fake token counter to prove:

- platform, character, and current user content are never removed;
- examples are included before live history only when budget permits;
- oldest complete user-assistant turns are removed first;
- chronological order is restored after newest-first selection;
- an orphan user or assistant history message is excluded;
- failed, interrupted, non-current, and cross-conversation attempts are absent;
- an impossible mandatory budget throws `CHAT_VALIDATION`; and
- user text containing `"ignore previous instructions"` remains a user-role
  message and never enters a system string.

- [ ] **Step 2: Run prompt tests to verify failure**

Run:

```bash
pnpm vitest run src/server/chat/prompt-assembler.test.ts
```

Expected: FAIL because the assembler does not exist.

- [ ] **Step 3: Implement structured character prompt projection**

Export the existing `PublishedCharacterVersion` type from
`character-queries.ts`; do not define a second incompatible shape.

Build a deterministic system message with explicit sections:

```ts
const characterInstruction = [
  `Character: ${character.displayName}`,
  "Personality principles:",
  ...character.personalityPrinciples.map((value) => `- ${value}`),
  `Speaking style: ${character.speakingStyle}`,
  `Response rhythm: ${character.responseRhythm}`,
  "Relationship boundaries:",
  ...character.relationshipBoundaries.map((value) => `- ${value}`),
  "Safety additions:",
  ...character.safetyAdditions.map((value) => `- ${value}`),
].join("\n");
```

Examples become ordinary user/assistant messages after the two system
messages. History selection operates on complete turn pairs. Reserve
`maxOutputTokens` before comparing estimated input against
`promptTokenBudget`.

- [ ] **Step 4: Run Task 4 tests**

Run:

```bash
pnpm vitest run src/server/chat/prompt-assembler.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add src/server/chat/prompt-assembler.ts src/server/chat/prompt-assembler.test.ts src/server/characters/character-content.ts
git commit -m "feat(chat): assemble bounded character prompts"
```

### Task 5: Build the OpenAI-Compatible Streaming Gateway

**Files:**

- Create: `src/server/model-gateway/model-contract.ts`
- Create: `src/server/model-gateway/model-error.ts`
- Create: `src/server/model-gateway/stream-parser.ts`
- Create: `src/server/model-gateway/stream-parser.test.ts`
- Create: `src/server/model-gateway/openai-compatible-gateway.ts`
- Create: `src/server/model-gateway/openai-compatible-gateway.integration.test.ts`
- Create: `src/test/fake-model-server.ts`

**Interfaces:**

- Consumes: Task 1 model configuration and Task 4 `GatewayMessage`.
- Produces:

```ts
export type GatewayStreamEvent =
  | { type: "provider-call"; callNumber: number }
  | { type: "request-id"; requestId: string }
  | { type: "delta"; text: string }
  | {
      type: "usage";
      inputTokens: number;
      outputTokens: number;
      estimated: false;
    };

export interface ModelGateway {
  stream(input: {
    messages: GatewayMessage[];
    modelId: string;
    temperature: number;
    topP: number;
    maxOutputTokens: number;
    firstTokenTimeoutMs: number;
    requestTimeoutMs: number;
    signal: AbortSignal;
  }): AsyncGenerator<GatewayStreamEvent, void>;
}
```

- [ ] **Step 1: Write failing SSE parser tests**

Cover fragmented UTF-8 bytes, multiple frames per chunk, comments, blank lines,
`data: [DONE]`, usage-only final chunks, malformed JSON, missing choices, and
EOF before `[DONE]`:

```ts
expect(await collect(parseOpenAiStream(chunks))).toEqual([
  { type: "delta", text: "你" },
  { type: "delta", text: "好" },
  {
    type: "usage",
    inputTokens: 10,
    outputTokens: 2,
    estimated: false,
  },
]);
```

- [ ] **Step 2: Run parser tests to verify failure**

Run:

```bash
pnpm vitest run src/server/model-gateway/stream-parser.test.ts
```

Expected: FAIL because the parser does not exist.

- [ ] **Step 3: Implement incremental parser and safe errors**

Use `TextDecoder` with streaming mode and retain an incomplete line buffer.
Throw `ModelGatewayError` with categories:

```ts
type ModelGatewayErrorCategory =
  | "authentication"
  | "rate_limit"
  | "first_token_timeout"
  | "total_timeout"
  | "connection"
  | "server"
  | "protocol"
  | "cancelled"
  | "interrupted";
```

Store safe status, provider request ID, retryability, and bounded
`retryAfterMs`; never store the raw response body.

- [ ] **Step 4: Write failing fake-provider contract tests**

Start `src/test/fake-model-server.ts` on an ephemeral loopback port. Program it
with named scenarios and assert:

- standard deltas and usage;
- missing usage;
- `x-request-id` capture;
- 401 maps to authentication;
- 429 parses bounded `Retry-After`;
- 500 is retryable before output;
- first-token timeout is distinguishable from total timeout;
- disconnect after one delta is interrupted and not automatically retried;
- malformed frames are protocol errors;
- abort signal closes the upstream request; and
- one automatic retry occurs only before the first delta.

Record received requests so the test can assert the API key and model were sent
to the provider but never returned in thrown error text.

- [ ] **Step 5: Implement gateway request and bounded retry**

Resolve `<base>/chat/completions`, set:

```ts
{
  model: input.modelId,
  messages: input.messages,
  temperature: input.temperature,
  top_p: input.topP,
  max_tokens: input.maxOutputTokens,
  stream: true,
  stream_options: { include_usage: true },
}
```

Use separate first-token and total timeout controllers combined with the user
signal. Retry once for connection, first-token timeout, 5xx, or a bounded 429
whose delay fits the remaining total timeout. Set `hasEmittedDelta` before
yielding the first delta; once true, rethrow every failure without retry.

- [ ] **Step 6: Run Task 5 tests**

Run:

```bash
pnpm vitest run src/server/model-gateway/stream-parser.test.ts src/server/model-gateway/openai-compatible-gateway.integration.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 5**

```bash
git add src/server/model-gateway src/test/fake-model-server.ts
git commit -m "feat(chat): add OpenAI-compatible streaming gateway"
```

### Task 6: Enforce Quotas, Reservations, and Generation Leases

**Files:**

- Create: `src/server/chat/quota-service.ts`
- Create: `src/server/chat/quota-service.integration.test.ts`

**Interfaces:**

- Consumes: Task 2 quota tables, Task 1 errors, and runtime settings.
- Produces:

```ts
export interface GenerationAdmission {
  attemptId: string;
  reservationId: string;
  leaseOwner: string;
  effectiveLimits: {
    userDailyRequests: number;
    userDailyTokens: number;
    instanceMonthlyRequests: number;
    instanceMonthlyTokens: number;
  };
}

export async function admitGeneration(
  transaction: ChatTransaction,
  input: {
    userId: string;
    conversationId: string;
    assistantMessageId: string;
    estimatedInputTokens: number;
    maxOutputTokens: number;
    now: Date;
  },
): Promise<GenerationAdmission>;

export async function settleGeneration(
  database: Database,
  input: GenerationSettlement,
): Promise<void>;

export async function reconcileExpiredLeases(
  database: Database,
  now: Date,
): Promise<number>;
```

- [ ] **Step 1: Write failing period and effective-limit tests**

Prove UTC boundaries:

```ts
expect(userPeriod(new Date("2026-10-09T23:59:59Z"))).toEqual({
  start: new Date("2026-10-09T00:00:00Z"),
  end: new Date("2026-10-10T00:00:00Z"),
});
expect(instancePeriod(new Date("2026-10-31T23:59:59Z")).end).toEqual(
  new Date("2026-11-01T00:00:00Z"),
);
```

Test nullable user override fields independently inherit global values.

- [ ] **Step 2: Write failing concurrency and accounting tests**

With two separate database pools, prove:

- only one of two concurrent final user request slots is admitted;
- only one of two concurrent final instance token reservations is admitted;
- only one lease exists for one user across different characters;
- only `maxConcurrentGenerations` leases are admitted instance-wide;
- lock acquisition follows global settings → instance bucket → user bucket →
  user lease → conversation without deadlock;
- failed admission creates no message-side reservation;
- settlement consumes one request, uses actual tokens, and releases unused
  reserved tokens;
- missing usage settles the safety-margin estimate and marks it estimated;
- repeated settlement is idempotent;
- expired lease reconciliation marks the attempt interrupted, flushes no new
  content, releases unused reservation once, and preserves consumed request;
- conversation deletion does not restore bucket counts; and
- disabled or deleted users cannot retain an active lease.

- [ ] **Step 3: Run quota tests to verify failure**

Run:

```bash
pnpm vitest run src/server/chat/quota-service.integration.test.ts
```

Expected: FAIL because the service does not exist.

- [ ] **Step 4: Implement transactional admission**

The generation service owns the transaction that inserts the user message,
assistant slot, attempt, reservation, and lease. `admitGeneration` receives that
same transaction; it must not start or commit a nested transaction.

Call `lockUserChatMutation(transaction, userId)`, then lock in the documented
order: instance bucket → user bucket → existing user lease → conversation.
Delete/reconcile expired leases before counting active slots. Reserve:

```ts
const reservedTokens = estimatedInputTokens + maxOutputTokens;
```

Throw distinct errors with `resetAt`:

```ts
throw new ChatDomainError(
  "CHAT_USER_TOKEN_QUOTA",
  "Your daily token limit has been reached.",
  { retryable: true, resetAt: userBucket.periodEnd },
);
```

Create reservation and lease only after every limit passes. Use IDs supplied by
the generation service so the message/attempt/reservation/lease write set is
committed or rolled back together.

- [ ] **Step 5: Implement idempotent settlement and reconciliation**

Settlement locks the reservation. If already terminal, return without changing
counters. Otherwise:

- consume the admitted request unit;
- replace reserved tokens with provider-reported or estimated actual tokens;
- append one ledger row per provider call;
- mark the reservation settled;
- remove the lease only when attempt and owner match; and
- retain numeric usage if conversation/account references later become null.

Reconciliation uses the same settlement path with outcome `interrupted`.

- [ ] **Step 6: Run Task 6 tests**

Run:

```bash
pnpm vitest run src/server/chat/quota-service.integration.test.ts
```

Expected: PASS with no hanging lock test.

- [ ] **Step 7: Commit Task 6**

```bash
git add src/server/chat/quota-service.ts src/server/chat/quota-service.integration.test.ts
git commit -m "feat(chat): enforce transactional quotas and leases"
```

### Task 7: Orchestrate Generation and Expose the Streaming API

**Files:**

- Create: `src/server/chat/generation-service.ts`
- Create: `src/server/chat/generation-service.integration.test.ts`
- Create: `src/app/api/chat/conversations/[id]/messages/route.ts`
- Create: `src/app/api/chat/conversations/[id]/messages/route.test.ts`
- Create: `src/app/api/chat/attempts/[id]/stop/route.ts`
- Create: `src/app/api/chat/attempts/[id]/stop/route.test.ts`

**Interfaces:**

- Consumes: Tasks 3-6.
- Produces:

```ts
export interface GenerationService {
  startNewMessage(input: {
    userId: string;
    conversationId: string;
    clientRequestId: string;
    content: string;
    signal: AbortSignal;
  }): AsyncGenerator<ChatStreamEvent, void>;
  retry(input: {
    userId: string;
    conversationId: string;
    clientRequestId: string;
    attemptId: string;
    signal: AbortSignal;
  }): AsyncGenerator<ChatStreamEvent, void>;
  stop(input: { userId: string; attemptId: string }): Promise<void>;
}
```

- [ ] **Step 1: Write failing generation integration tests**

Inject a fake `ModelGateway`, deterministic clock, ID factory, and token
counter. Test:

- admission persists one user message, assistant slot, attempt, reservation,
  and lease before the gateway starts;
- idempotency replay returns `CHAT_GENERATION_IN_PROGRESS` with the existing
  attempt/conversation IDs while that attempt is nonterminal, or the persisted
  terminal state after completion, and never calls the gateway twice;
- deltas are yielded and partial content checkpoints at 500ms or 1 KiB;
- completion stores final content and provider usage;
- missing usage uses the local estimate;
- stop sets the cancel flag, aborts the gateway, flushes partial text, and
  settles interrupted;
- browser signal abort follows the same path;
- provider error before any delta may retry once through the gateway;
- provider error after a delta becomes interrupted without automatic retry;
- manual retry is accepted only for the current failed/interrupted attempt,
  creates the next attempt number, and changes `is_current` atomically;
- disabled user, archived conversation, wrong owner, and second concurrent
  generation fail before provider contact;
- account deletion during streaming causes the next checkpoint to stop safely,
  emits no further user-visible delta, and leaves no lease/reservation orphan.
- a simulated process crash plus lease expiry is reconciled exactly once.

- [ ] **Step 2: Run generation tests to verify failure**

Run:

```bash
pnpm vitest run src/server/chat/generation-service.integration.test.ts
```

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement generation orchestration**

The service sequence is:

```ts
validateInput();
const prepared = await prepareTurnAndAdmission();
yield { type: "started", attemptId: prepared.attemptId };
try {
  for await (const event of gateway.stream(prepared.gatewayInput)) {
    await handleGatewayEvent(event);
    if (event.type === "delta") {
      yield { type: "delta", attemptId: prepared.attemptId, text: event.text };
    }
  }
  await completeAttempt();
  yield completedEvent();
} catch (error) {
  const terminal = await failOrInterruptAttempt(error);
  yield terminal;
}
```

Do not swallow database settlement failure. If headers have already streamed,
emit a safe terminal internal error when possible and log identifiers only.
Check `cancel_requested_at` between provider chunks. Treat a missing
conversation, attempt, or user during checkpointing as cancellation/account
deletion rather than recreating state.

- [ ] **Step 4: Write failing route tests**

Mock `requireSession` and the generation service. Assert:

- invalid JSON, empty content, overlong content, invalid UUID/idempotency key,
  and wrong content type return typed 400 responses;
- unauthenticated/banned requests follow authoritative auth behavior;
- successful response uses `application/x-ndjson`, `no-store`, and streams one
  JSON object per line;
- domain errors map to stable status codes;
- duplicate idempotency key returns a typed conflict containing the existing
  attempt/conversation IDs without duplicate stream startup;
- request bodies form a strict union of
  `{ clientRequestId, content }` and
  `{ clientRequestId, retryAttemptId }`;
- the route request signal reaches the service; and
- stop returns 202 only for an owned active attempt and 404 for another user.

- [ ] **Step 5: Implement API routes and NDJSON encoder**

Dispatch the strict body union to `startNewMessage` or `retry`. Use a
`ReadableStream` that advances the async generator and encodes:

```ts
const line = `${JSON.stringify(event)}\n`;
controller.enqueue(encoder.encode(line));
```

Set:

```ts
{
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
}
```

Never include provider error bodies in route output.

- [ ] **Step 6: Run Task 7 tests**

Run:

```bash
pnpm vitest run src/server/chat/generation-service.integration.test.ts src/app/api/chat/conversations/[id]/messages/route.test.ts src/app/api/chat/attempts/[id]/stop/route.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 7**

```bash
git add src/server/chat/generation-service.ts src/server/chat/generation-service.integration.test.ts src/app/api/chat
git commit -m "feat(chat): stream durable model generations"
```

### Task 8: Build the Focused Chat and History Experience

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `src/app/app/page.tsx`
- Modify: `src/app/app/page.test.tsx`
- Create: `src/app/app/conversations/actions.ts`
- Create: `src/app/app/conversations/actions.test.ts`
- Create: `src/app/app/conversations/[id]/page.tsx`
- Create: `src/app/app/conversations/[id]/page.test.tsx`
- Modify: `src/app/characters/[slug]/page.tsx`
- Modify: `src/app/characters/[slug]/page.test.tsx`
- Create: `src/components/chat/chat-screen.tsx`
- Create: `src/components/chat/chat-screen.test.tsx`
- Create: `src/components/chat/chat-composer.tsx`
- Create: `src/components/chat/chat-composer.test.tsx`
- Create: `src/components/chat/chat-timeline.tsx`
- Create: `src/components/chat/chat-message.tsx`
- Create: `src/components/chat/safe-markdown.tsx`
- Create: `src/components/chat/safe-markdown.test.tsx`
- Create: `src/components/chat/conversation-history.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**

- Consumes: Task 3 queries/actions and Task 7 NDJSON endpoints.
- Produces: focused responsive chat UI, start/open, restart, deletion, stop,
  retry, and read-only history.

- [ ] **Step 1: Install safe Markdown rendering**

Run:

```bash
pnpm add --save-exact react-markdown
```

Do not install or enable `rehype-raw`.

- [ ] **Step 2: Write failing safe-Markdown tests**

Assert paragraphs, lists, emphasis, blockquotes, inline/fenced code, and safe
links render. Assert raw HTML is text/omitted, images do not render, javascript
links have no navigable `href`, and external links receive:

```ts
expect(link).toHaveAttribute("rel", "noopener noreferrer");
expect(link).toHaveAttribute("target", "_blank");
expect(screen.queryByRole("img")).not.toBeInTheDocument();
expect(container.querySelector("script")).toBeNull();
```

- [ ] **Step 3: Write failing page/action/component tests**

Cover:

- `/app` lists active character conversations and browse-character CTA;
- signed-in character detail shows “Start conversation” or “Continue
  conversation”; anonymous detail links through sign-in with a safe return URL;
- start/open redirects to the owned active conversation;
- focused page renders opening, user, streaming, complete, failed, and
  interrupted states;
- archived page has no composer and shows delete/back actions;
- generation changes send to stop;
- NDJSON parser handles chunk boundaries and terminal events;
- partial content remains after stop;
- retry replaces the visible bubble;
- generation-in-progress links to the owning conversation;
- restart confirmation archives and redirects to the new ID;
- active/archived deletion confirmation returns to the correct page;
- old pinned version notice appears when the default differs; and
- provider/model configuration details never render.

- [ ] **Step 4: Run UI tests to verify failure**

Run:

```bash
pnpm vitest run src/components/chat src/app/app/page.test.tsx src/app/app/conversations src/app/characters/[slug]/page.test.tsx
```

Expected: FAIL because the UI does not exist.

- [ ] **Step 5: Implement conversation actions**

Each server action calls `requireSession(await headers())`, passes
`session.user.id`, and maps `ChatDomainError` to a user-safe state:

```ts
export interface ConversationActionState {
  status: "idle" | "success" | "error";
  message?: string;
  conversationId?: string;
}
```

Use redirects only after successful start/restart. Revalidate `/app`, the old
conversation route, the new route, and the character detail as applicable.

- [ ] **Step 6: Implement the streaming client**

`ChatComposer` creates `crypto.randomUUID()` once per submission, calls the
message endpoint, reads `response.body.getReader()`, retains incomplete lines,
and applies events by `attemptId`. Stop calls the stop endpoint before aborting
the local fetch controller.

On component unmount, abort the fetch. Do not mark the message complete unless
the `completed` event was parsed.

- [ ] **Step 7: Implement focused layout and history**

Use semantic controls and live regions:

```tsx
<section aria-label="Conversation">
  <ChatTimeline messages={messages} />
  {conversation.lifecycle === "active" ? (
    <ChatComposer conversationId={conversation.id} />
  ) : (
    <p role="status">This archived conversation is read-only.</p>
  )}
</section>
```

Keep history in a `<dialog>` or accessible disclosure. Add responsive CSS
without a permanent desktop sidebar. Disable composer while another attempt is
active.

- [ ] **Step 8: Run Task 8 tests**

Run:

```bash
pnpm vitest run src/components/chat src/app/app/page.test.tsx src/app/app/conversations src/app/characters/[slug]/page.test.tsx
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit Task 8**

```bash
git add package.json pnpm-lock.yaml src/app/app src/app/characters/[slug] src/components/chat src/app/globals.css
git commit -m "feat(chat): add focused streaming conversation UI"
```

### Task 9: Add Aggregate Usage and Quota Administration

**Files:**

- Create: `src/server/admin/usage-queries.ts`
- Create: `src/server/admin/usage-queries.integration.test.ts`
- Create: `src/server/admin/chat-settings-service.ts`
- Create: `src/server/admin/chat-settings-service.integration.test.ts`
- Modify: `src/server/admin/user-service.ts`
- Modify: `src/server/admin/user-service.integration.test.ts`
- Create: `src/app/admin/usage/page.tsx`
- Create: `src/app/admin/usage/page.test.tsx`
- Create: `src/app/admin/usage/actions.ts`
- Create: `src/app/admin/usage/actions.test.ts`
- Modify: `src/app/admin/layout.tsx`
- Modify: `src/app/admin/users/page.tsx`
- Modify: `src/app/admin/users/page.test.tsx`
- Modify: `src/app/admin/users/actions.ts`
- Modify: `src/app/admin/users/actions.test.ts`

**Interfaces:**

- Consumes: Task 2 settings/ledger and existing `requireAdminWrite`/audit.
- Produces:

```ts
export function getUsageDashboard(
  database: Database,
  now: Date,
): Promise<UsageDashboard>;

export async function updateGlobalChatSettings(
  database: Database,
  actor: AdminActor,
  input: UpdateGlobalChatSettingsInput,
): Promise<{ revision: number }>;

export async function setUserChatQuotaOverride(
  database: Database,
  actor: AdminActor,
  input: {
    userId: string;
    dailyRequestLimit: number | null;
    dailyTokenLimit: number | null;
  },
): Promise<void>;
```

- [ ] **Step 1: Write failing aggregate privacy tests**

Seed ledger rows containing IDs and numeric usage plus messages containing a
unique secret phrase. Assert dashboard totals, outcomes, estimated usage,
latency percentiles, retry counts, and current leases are correct, then assert:

```ts
expect(JSON.stringify(dashboard)).not.toContain(secretPhrase);
expect(Object.keys(dashboard)).not.toContain("messages");
```

Delete conversation/account and prove de-identified numeric totals remain.

- [ ] **Step 2: Write failing settings and override service tests**

Test:

- current administrator is rechecked inside the transaction;
- optimistic revision conflict changes nothing;
- invalid/nonpositive/cross-field limits fail before mutation;
- global update increments revision and audits changed numeric fields;
- reset restores stored deployment defaults and audits;
- ordinary-user overrides independently inherit nullable fields;
- admin/future-role/self targets are rejected consistently with user controls;
- clear removes the row and audits;
- metadata contains values and field names but no messages/provider secrets;
  and
- changes affect only new admissions.
- disabling a user atomically sets `cancel_requested_at` on every active
  generation attempt before session revocation completes; the generation loop
  observes it and settles interrupted without exposing further deltas.

- [ ] **Step 3: Run admin service tests to verify failure**

Run:

```bash
pnpm vitest run src/server/admin/usage-queries.integration.test.ts src/server/admin/chat-settings-service.integration.test.ts src/server/admin/user-service.integration.test.ts
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 4: Implement privacy-safe aggregate queries**

Query only `usage_ledger`, quota buckets, settings, and leases. Return:

```ts
export interface UsageDashboard {
  userDay: { requests: number; inputTokens: number; outputTokens: number };
  instanceMonth: {
    requests: number;
    inputTokens: number;
    outputTokens: number;
  };
  activeGenerations: number;
  outcomes: Record<"complete" | "failed" | "interrupted", number>;
  failures: Array<{ category: string; count: number }>;
  automaticRetries: number;
  estimatedUsageRows: number;
  latencyMs: { p50: number | null; p95: number | null };
  modelIds: string[];
}
```

Do not join conversation messages or generation content.

- [ ] **Step 5: Implement transactional settings services**

Call `requireAdminWrite(transaction, actor)` before locking the singleton or
target user. Record actions from Task 2. Keep audit metadata flat:

```ts
{
  previousRevision,
  nextRevision,
  userDailyRequestLimit,
  userDailyTokenLimit,
  instanceMonthlyRequestLimit,
  instanceMonthlyTokenBudget,
  maxConcurrentGenerations,
}
```

- [ ] **Step 6: Write failing pages/actions tests**

Assert admin navigation includes Usage; ordinary users cannot render it; global
form preserves values on validation/conflict error; reset requires
confirmation; user page shows aggregate current-period usage and override
fields without content; actions map domain errors safely and revalidate
`/admin/usage` and `/admin/users`.

- [ ] **Step 7: Implement admin UI**

Add `/admin/usage` cards, failure table, settings form, and reset confirmation.
Extend each ordinary-user result with request/token override controls. Do not
add transcript links or conversation IDs.

Extend `disableOrdinaryUser` in its existing transaction to mark the target
user's active attempts cancelled. Keep the lease until generation settlement
or expiry reconciliation so request/token accounting remains exactly-once.
Add an integration test that disables a user during a leased attempt and proves
sessions are revoked, cancellation is requested, and no quota is restored.

- [ ] **Step 8: Run Task 9 tests**

Run:

```bash
pnpm vitest run src/server/admin/usage-queries.integration.test.ts src/server/admin/chat-settings-service.integration.test.ts src/app/admin/usage src/app/admin/users
```

Expected: PASS.

- [ ] **Step 9: Commit Task 9**

```bash
git add src/server/admin src/app/admin
git commit -m "feat(admin): manage chat quotas and aggregate usage"
```

### Task 10: Complete Browser Acceptance, Deployment, and Release Gate

**Files:**

- Create: `tests/e2e/support/fake-model-server.ts`
- Modify: `tests/e2e/support/environment.ts`
- Modify: `playwright.config.ts`
- Create: `tests/e2e/chat.spec.ts`
- Create: `tests/e2e/chat-quotas.spec.ts`
- Modify: `tests/e2e/characters.spec.ts`
- Modify: `docker-compose.yml`
- Modify: `compose.test.yml`
- Modify: `Dockerfile`
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-09-23-ai-companion-roadmap.md`
- Modify: deployment/configuration tests affected by the new strict settings.

**Interfaces:**

- Consumes: all prior tasks.
- Produces: deployable Phase 3 release and independent browser acceptance.

- [ ] **Step 1: Add a deterministic E2E model server**

Run it as the third Playwright web server on `127.0.0.1:3102`. Support
scenario markers in user text:

```ts
const scenarios = {
  "[stream]": streamChunks(["Hello", " there"], usage(20, 2)),
  "[slow]": delayFirstToken(31_000),
  "[interrupt]": streamThenDisconnect("Partial reply"),
  "[rate-limit]": respond(429, { retryAfter: "1" }),
  "[auth-fail]": respond(401),
};
```

Expose a test-only control endpoint to reset request logs and select missing
usage without putting that endpoint in production code.

Add model environment variables to `createE2eEnvironment`.

- [ ] **Step 2: Write the primary chat E2E test**

One browser scenario must:

1. register/verify/sign in a user;
2. start Calm Listener and see its opening without a provider request;
3. send `[stream]` and observe partial then complete output;
4. send `[interrupt]`, retain partial as interrupted, and retry successfully;
5. stop a long generation and retain partial;
6. refresh during an abandoned generation and see interrupted rather than
   complete;
7. open another character tab and see the one-generation-per-user error;
8. restart and see the old conversation in read-only history;
9. delete archived history; and
10. delete the active conversation.

- [ ] **Step 3: Extend character version-pinning E2E**

Reuse the existing administrator character flow:

1. publish/select v1;
2. user starts chat and records v1 opening;
3. administrator publishes/selects v2;
4. existing active chat still shows v1 and accepts a message with v1 prompt;
5. restart archives v1;
6. new active chat shows v2 opening and provider request contains v2
   instructions; and
7. archive the character, prove existing chat remains usable, and prove restart
   is unavailable.

- [ ] **Step 4: Write quota, isolation, and privacy E2E**

Use two users and small administrator-configured limits. Prove:

- user A and B cannot access each other's conversation URL, stop endpoint, or
  streamed events;
- request quota and token quota have different messages/reset timestamps;
- instance request and token budgets have different messages;
- provider 429, timeout, authentication failure, and interrupted stream remain
  explicit;
- per-user override changes only the target user;
- `/admin/usage` totals match fake-provider activity;
- the unique message phrase does not appear in admin HTML, audit HTML, or
  captured application logs; and
- provider key/base URL do not appear in browser responses or built static
  assets.

- [ ] **Step 5: Run targeted browser tests**

Run:

```bash
pnpm db:deploy
pnpm playwright test tests/e2e/chat.spec.ts tests/e2e/chat-quotas.spec.ts tests/e2e/characters.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Wire production deployment configuration**

Pass model variables into app and migration/seed commands without exposing them
as public build arguments. Document trusted local HTTP model servers and
provider privacy responsibility. Ensure `db:deploy` seeds chat settings.

Update readiness shape to include:

```ts
checks: {
  database: "ok" | "error";
  worker: "ok" | "error";
  modelConfiguration: "ok" | "error";
}
```

Do not make a provider request in each readiness probe. A provider outage does
not fail non-chat site readiness.

- [ ] **Step 7: Update documentation and roadmap**

README must document:

- model URL/key/model configuration;
- chat safety bounds and initial quotas;
- first-deploy versus administrator-edited settings;
- one active conversation per character;
- restart/archive/delete semantics;
- version pinning;
- stop/retry/incomplete states;
- UTC quota resets;
- aggregate-only administration;
- provider data/privacy responsibility; and
- local fake-provider test setup.

Mark Phase 3 complete in the roadmap only after every release-gate command
passes.

- [ ] **Step 8: Run the complete release gate**

Run:

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
```

Expected:

- every Vitest file passes;
- every Playwright test passes;
- typecheck, lint, and production build exit 0;
- schema generation reports no schema drift;
- diff check exits 0;
- compiler prints `Version 7.0.2`; and
- imported compatibility API prints `6.0.3`.

- [ ] **Step 9: Request independent whole-branch review**

Review against:

- the Phase 3 spec;
- cross-user authorization;
- quota/concurrency race safety;
- stream interruption and idempotency;
- provider-secret and message-content privacy;
- deletion/account-deletion semantics; and
- Docker self-hosting behavior.

Fix every critical or important finding in one bounded repair wave, rerun the
full release gate, and preserve reviewer evidence.

- [ ] **Step 10: Commit Task 10**

```bash
git add tests/e2e playwright.config.ts docker-compose.yml compose.test.yml Dockerfile README.md docs/superpowers/plans/2026-09-23-ai-companion-roadmap.md src/server/health src/test
git commit -m "feat(chat): complete streaming chat release"
```

## Execution Notes

- Create the implementation branch in a Superpowers-owned worktree when
  execution begins; do not implement directly on `main`.
- Run `pnpm db:test:up` before the first PostgreSQL integration task and keep
  it running until the branch release gate finishes.
- Integration suites truncate all new chat tables in foreign-key-safe order.
- Vitest integration tests can remove seeded settings and characters, so run
  `pnpm db:deploy` again immediately before Playwright.
- Never weaken a concurrency test into a mocked unit test. Use separate
  PostgreSQL connections and verify the losing request actually waits on a
  database lock where ordering matters.
- Keep checkpoint timing injectable in tests; do not add multi-second sleeps.
- Keep fake model servers loopback-only and test-only.
- Stop test containers after branch integration unless the user explicitly
  asks to keep the local stack running.
