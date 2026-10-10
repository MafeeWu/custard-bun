# AI Companion Delivery Roadmap

**Spec:** `docs/superpowers/specs/2026-09-23-ai-companion-web-app-design.md`

The approved specification spans several independently reviewable subsystems.
Implement it as four plans. Each phase must leave the repository deployable
and must pass its own acceptance tests before the next phase begins.

## Phase 1: Deployable Foundation and Accounts

**Detailed plan:** `docs/superpowers/plans/2026-09-23-foundation-and-accounts.md`

Deliver:

- Next.js application and test harness
- Strict public and secret runtime configuration
- Runtime branding
- PostgreSQL, Drizzle migrations, and pg-boss worker
- SMTP-backed authentication email jobs
- Public email/password registration with email verification
- Login, logout, password reset, protected application shell, account deletion
- Registration switch, database-backed auth rate limiting, and server-side
  session validation
- Docker images, Docker Compose, health checks, and deployment documentation

Independent acceptance test: a deployer starts the stack, changes branding
without rebuilding, registers and verifies a user, signs in, reaches a
protected empty application shell, resets the password, and deletes the
account.

## Phase 2: Official Characters and Administration

**Detailed plan:** `docs/superpowers/plans/2026-10-08-official-characters-and-administration.md`

**Status:** Complete. Implementation, acceptance coverage, full release gate,
and the approved TypeScript 7 compiler plus official TypeScript 6 API
compatibility lint-toolchain fix are delivered.

Deliver:

- Character and immutable character-version schema
- Five distinct, idempotently deployed seed characters
- Public catalog and character detail screens
- Admin authentication and user disable/restore controls
- Character drafting, previewing, publishing, and default-version selection
- Audit events for administrative mutations

Independent acceptance test: an administrator publishes v1, explicitly selects
it as default, then publishes v2 without changing public v1 reads. Selecting v2
changes `resolveDefaultCharacterVersion`, while the previous immutable version
remains loadable by ID through `getPublishedCharacterVersion`. Archive removes public
selection without invalidating that immutable version; restore reinstates the
selected default. Browser coverage also verifies anonymous catalog browsing,
administrator authorization, ordinary-user disable/session revocation/restore,
and privacy-safe audit events. Actual conversation pinning belongs to Phase 3.

## Phase 3: Streaming Chat, Model Gateway, and Quotas

**Detailed plan:** `docs/superpowers/plans/2026-10-09-streaming-chat-model-gateway-and-quotas.md`

**Status:** Complete. Implementation, browser acceptance, secure deployment
and readiness wiring, operator documentation, and the full release gate are
delivered.

Deliver:

- Conversation and message state model
- Prompt assembly with precedence and token budgets
- OpenAI-compatible model gateway
- Streaming chat UI and explicit incomplete/failed states
- Retry-before-first-token behavior
- Per-user quotas, instance budgets, concurrency limits, and typed errors
- Aggregate usage and provider-failure administration

Independent acceptance test: two users can chat with the same character
without crossing data boundaries; timeout, rate limit, interrupted stream,
user quota, and instance budget produce explicit recoverable states.
After an administrator publishes and selects a new default character version,
an existing conversation remains pinned to its original version and a newly
created conversation selects the new default. Verify this in the browser once
conversation storage and chat exist.

## Phase 4: Long-Term Memory, Privacy, and Operational Completion

**Status:** Implementation and automated acceptance complete. The Node 24
release gate, real Phase 3 fixture upgrade, production Compose app/worker
readiness and processing, and deterministic all-surface privacy scan pass.
Independent whole-branch review remains pending (reviewers were explicitly
prohibited for Task 12). Phase 4 is not fully accepted until that final
specification release gate passes.

The separate implementation plan and approved specification are under
`docs/superpowers/plans/2026-10-10-long-term-memory-privacy-and-operations.md`
and `docs/superpowers/specs/2026-10-10-long-term-memory-privacy-and-operations-design.md`.

Deliver:

- Structured user-character memories and relationship summaries
- Asynchronous extraction, merge, exclusion, retry, and dead-letter handling
- Memory viewing, editing, per-item deletion, disablement, and per-character
  forgetting
- Conversation deletion versus relationship-memory deletion
- Full data export and cross-module account deletion
- Sensitive-data logging controls and operational dashboards
- End-to-end recall and forgetting acceptance scenario

Independent acceptance test: a character recalls a durable preference in a
new conversation, the user deletes that memory, and later prompts no longer
contain it; cross-user and cross-character isolation tests pass.

## Cross-Phase Rules

- Do not add voice, image generation, public characters, billing, RAG,
  plugins, relationship levels, or model selection during these phases.
- Keep the application a modular monolith with PostgreSQL as its only required
  stateful dependency.
- Keep provider secrets on the server and private conversation content out of
  normal administration views and logs.
- Every phase uses test-driven development, ends in a deployable state, and
  receives an independent code review before the next phase starts.
