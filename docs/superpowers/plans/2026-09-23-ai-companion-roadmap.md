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

Create a separate implementation plan after Phase 1 is accepted.

Deliver:

- Character and immutable character-version schema
- Four to six seed characters
- Public catalog and character detail screens
- Admin authentication and user disable/restore controls
- Character drafting, previewing, publishing, and default-version selection
- Audit events for administrative mutations

Independent acceptance test: an administrator publishes a new character
version, existing conversations remain pinned to the old version, and new
conversations select the new default.

## Phase 3: Streaming Chat, Model Gateway, and Quotas

Create a separate implementation plan after Phase 2 is accepted.

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

## Phase 4: Long-Term Memory, Privacy, and Operational Completion

Create a separate implementation plan after Phase 3 is accepted.

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
