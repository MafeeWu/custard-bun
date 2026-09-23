# Open-Source AI Companion Web App Design

Date: 2026-09-23
Status: Approved design

## 1. Product Intent

Build an open-source, self-hosted, white-label web application for ordinary
users to have private, ongoing conversations with a small catalog of official
AI characters.

The product is not a general-purpose ChatGPT frontend. Its primary value is
consistent character personality, relationship continuity, and user-controlled
long-term memory. Self-hosting and white-label configuration are distribution
features rather than the core user experience.

### Target deployment

- The deployer provides and pays for the model backend.
- The instance supports public user registration.
- Users never need to configure a model, endpoint, or API key.
- The initial release offers official characters only.
- Characters remember durable user facts and shared context across sessions.

## 2. Existing Open-Source Landscape

Several existing projects cover parts of this idea, but none is an ideal base
for the approved product:

| Project | Relevant strengths | Reason not selected as the base |
|---|---|---|
| [LibreChat](https://github.com/danny-avila/LibreChat) | Mature accounts, multi-provider chat, administration | Its product and data model center on general-purpose assistants and model selection; companion relationships and memory would require deep changes |
| [NextChat](https://github.com/ChatGPTNextWeb/NextChat) | Lightweight, easy to deploy, MIT licensed | Public accounts, server-side cost controls, administration, and durable memory would largely need to be built from scratch |
| [AnythingLLM](https://github.com/Mintplex-Labs/anything-llm) | MIT licensed, strong self-hosting and knowledge workflows | Optimized for documents, workspaces, and RAG rather than character relationships |
| [SillyTavern](https://github.com/SillyTavern/SillyTavern) | Deep character cards, roleplay controls, persistent character context | AGPL-3.0, desktop/single-user product shape, and a roleplay-heavy interface make consumer multi-user adaptation expensive |
| [Open WebUI](https://github.com/open-webui/open-webui) | Broad model support, administration, tools, and self-hosting | Its current license restricts replacing Open WebUI branding for deployments exceeding 50 users without permission or an enterprise license |
| [LobeChat](https://github.com/lobehub/lobe-chat) | Polished user experience and agent ecosystem | Its current community license requires a commercial license to develop and distribute a commercial derivative |

The selected direction is a focused new project that uses open protocols and
mature libraries rather than forking a general-purpose chat product.

## 3. Initial Release Scope

### Included

- Responsive, mobile-first web application with PWA installation support
- Email registration, email verification, login, logout, and account recovery
- Public registration that the deployer can enable or disable
- Catalog of approximately four to six official characters
- Character profile and conversation entry point
- Private, streaming one-to-one chat
- Conversation history
- User-specific, character-specific long-term memory
- Memory viewing, editing, deletion, and global disablement
- Clear separation between deleting a conversation and deleting relationship
  memory
- User profile, privacy controls, data export, and account deletion
- Per-user and instance-wide usage limits
- Basic administration for users, characters, prompt versions, usage, and
  failed background jobs
- Runtime branding and model-backend configuration

### Excluded

- User-created or publicly shared characters
- Character marketplace, ratings, comments, or discovery feeds
- Group chat or character-to-character chat
- Voice calls, speech generation, avatars, and video
- Image generation
- Knowledge bases, document upload, RAG, plugins, and external tools
- Relationship levels, affection scores, unlockable events, or other
  game-like progression
- Payments, subscriptions, credits, and billing
- Native mobile applications

## 4. Architecture

Use a modular monolith for the initial release. Keep module boundaries explicit
without introducing separately deployed business microservices.

### 4.1 Application

Use TypeScript and Next.js for the responsive web UI, application API,
authentication flows, administration, and streaming chat endpoint.

Logical modules:

- Identity and account lifecycle
- Character catalog and character-version publishing
- Conversations and messages
- Prompt assembly and model gateway
- Long-term memory
- Usage, quotas, and rate limiting
- Administration and audit events
- Runtime configuration

Modules communicate through typed internal interfaces. A module must not read
another module's tables directly when an internal service interface exists.

### 4.2 Database

Use PostgreSQL for:

- Users, credentials, sessions, and verification tokens
- Characters and immutable published character versions
- Conversations and messages
- Structured memories and relationship summaries
- Usage counters and instance budgets
- Persistent background jobs
- Administrative audit events

PostgreSQL is the only required stateful dependency in the initial release.

### 4.3 Background Worker

Run a separate worker process from the same application image. Use a durable
PostgreSQL-backed task queue so deployments do not require Redis.

The worker handles:

- Memory extraction and consolidation
- Relationship-summary refresh
- Retriable maintenance tasks
- Account data export and deletion when they are too large for a request

Worker failures must be visible to administrators and retried with bounded
backoff. A memory-processing failure must not change a completed chat response
into a failed response.

### 4.4 Model Gateway

The application calls a deployer-configured OpenAI-compatible API from the
server only.

Required secret settings:

- API base URL
- API key
- Chat model identifier

The browser must never receive the API key. The gateway owns request timeouts,
stream parsing, token and cost accounting, provider error normalization, and
request identifiers. The initial release exposes one active chat-model
configuration to users; users cannot choose the underlying model.

### 4.5 Deployment

The supported default deployment is Docker Compose with:

- `app`
- `worker`
- `postgres`

The app and worker use the same image with different startup commands.

Public, non-secret configuration belongs in `app.config.yml`, including:

- Product name, description, logo, favicon, and primary color
- Registration policy
- Default character
- User and instance quotas
- Public legal and support links

Secrets belong in environment variables, including:

- PostgreSQL connection
- Authentication/session secret
- SMTP credentials
- Model API base URL, key, and model identifier

Startup validates the entire configuration. Missing or invalid required values
must prevent startup and produce a specific error.

## 5. Character Model

An official character is a versioned package containing:

- Stable identifier
- Display name, avatar, short description, and long description
- Personality principles
- Speaking style and response rhythm
- Relationship boundaries
- Opening message
- A small set of example conversations
- Recommended generation parameters
- Safety additions specific to the character

Publishing creates an immutable character version. Existing conversations stay
on their current version by default so an administrative edit cannot suddenly
change a character's personality. Administrators may explicitly migrate a
conversation or set a newer version for new conversations.

The initial catalog should contain distinct interaction styles, such as a calm
listener, energetic friend, rational companion, and creative storyteller.
Characters must differ in principles and conversational behavior, not only in
word choice.

## 6. Prompt Assembly

Assemble each model request in this precedence order:

1. Platform safety and behavioral rules
2. Published character definition
3. User-character relationship summary and structured memories
4. Recent conversation messages
5. Current user message

Memory and user-provided content are untrusted data, not instructions. They
must be delimited and must not be allowed to override platform or character
rules.

Prompt assembly applies an explicit token budget. It preserves platform rules,
character definition, and the current message first; it then includes recent
context and memories within their assigned budgets.

## 7. Long-Term Memory

Memory belongs to exactly one user and one character. It must never be shared
across users or characters.

The initial release uses three context layers:

1. Recent raw messages for immediate continuity
2. Structured durable facts, such as preferred name, preferences, important
   people, and explicit future plans
3. A compact relationship summary containing shared events and unresolved
   commitments

The initial release does not require embeddings or a vector database. The
worker extracts candidate facts after a completed response, merges duplicates,
updates confidence and recency, and periodically refreshes the relationship
summary.

Each memory records:

- User and character identifiers
- Type and normalized content
- Source message identifiers
- Creation and last-confirmed times
- Confidence and importance
- Active, edited, or deleted state

Users can:

- Inspect what each character remembers
- Edit incorrect memories
- Delete individual memories
- Disable future memory creation
- Delete all memory for one character

By default, the system must not persist passwords, API keys, exact addresses,
financial credentials, or sensitive identity traits inferred rather than
explicitly supplied. Account deletion removes messages, memories, and derived
summaries.

## 8. Chat Request Flow

1. Authenticate the user.
2. Check account state, rate limits, user quota, instance budget, concurrency,
   and message length.
3. Persist the user message.
4. Load the pinned character version, recent messages, active memories, and
   relationship summary.
5. Assemble the prompt within the token budget.
6. Call the model gateway and stream tokens to the browser.
7. Persist the assistant response and usage data.
8. Mark the message complete.
9. Enqueue memory processing.

If the provider fails before any token is returned, the gateway may perform a
bounded automatic retry. Once output has started, it must not retry
automatically because doing so can produce duplicate or contradictory text.

Interrupted and failed generations remain explicit message states. The UI
offers a retry action and never displays a provider failure as a successful
assistant response.

## 9. Registration, Cost, and Abuse Controls

Public registration requires:

- Verified email
- Per-IP registration throttling
- Per-user message and token limits
- Instance-wide daily or monthly budget
- Configurable maximum concurrent generations
- Maximum input and output lengths

When a limit is reached, the API returns a typed error and the UI explains
which limit was reached and when it resets. The system must not silently switch
models or use a success-shaped fallback.

Administrators can:

- Open or close registration
- Disable or restore accounts
- Change quotas and instance budgets
- Review aggregate usage and provider failure rates
- Review failed worker jobs

Administrators cannot browse private conversation text through the normal
administration UI. Exceptional support or legal-access workflows are outside
the initial release.

## 10. Companion Safety and Privacy

- Every character is clearly identified as AI and must not claim to be human.
- Characters must not pressure users into exclusivity or emotional dependency.
- The product must not tie payment to preserving a relationship.
- Crisis, self-harm, and minor-safety situations use platform-level rules that
  character prompts cannot override.
- Private messages and memories are excluded from general administrative
  views.
- Sensitive configuration values are redacted from logs.
- Logs use request and user identifiers rather than message bodies wherever
  possible.
- Account deletion and per-character forgetting are first-class, testable
  workflows.

## 11. User Experience

Primary screens:

- Branded landing page
- Registration, verification, login, and recovery
- Character catalog
- Character detail
- Chat
- Conversation history
- Memory management
- Account, privacy, and data controls
- Administration

The consumer UI does not expose provider names, API endpoints, keys,
temperature, token limits, or model selection.

"Delete conversation" removes the selected transcript. "Make this character
forget me" removes the user-character memories and relationship summary. These
actions must use distinct labels and confirmations.

## 12. Error Handling and Observability

Normalize errors into typed categories:

- Authentication and authorization
- Validation
- Rate or quota limit
- Instance budget exhausted
- Provider authentication
- Provider rate limit
- Provider timeout
- Stream interrupted
- Database failure
- Background job failure
- Invalid deployment configuration

Every model request receives a request identifier. Log operational metadata,
latency, token usage, error category, and retry count without logging message
content by default.

Expose health checks for the application, database, worker heartbeat, and
model-backend configuration. A provider outage may degrade chat availability
but must not corrupt stored conversations or memories.

## 13. Testing

### Unit tests

- Configuration parsing, defaults, and rejection of invalid settings
- Character-version publishing
- Prompt precedence and token budgeting
- Memory extraction normalization and duplicate merging
- Sensitive-memory exclusion
- Quota and budget calculations
- Provider error normalization

### Integration tests

- Registration, verification, authentication, and account deletion
- Authorization and privacy isolation across users
- Memory isolation across characters
- Streaming success, timeout, rate limit, and interruption
- Retry rules before and after the first streamed token
- Worker retry and dead-letter behavior
- Conversation deletion versus relationship-memory deletion
- Model gateway contract against a fake OpenAI-compatible server

### End-to-end tests

The critical scenario is:

1. Register and verify a user.
2. Start a conversation with an official character.
3. State a durable preference.
4. Complete memory processing.
5. Start a new conversation with the same character.
6. Confirm correct recall.
7. Delete the memory.
8. Start another conversation and confirm the deleted fact is not used.

Additional end-to-end coverage verifies branding configuration, quota
exhaustion, account deletion, and administrator character publishing.

## 14. Initial Release Acceptance Criteria

- A deployer can start the product through Docker Compose without editing
  source code.
- Product name, logo, favicon, primary color, registration policy, quotas, and
  model backend are configurable outside the application image.
- A new user can move from registration to the first character message within
  two minutes, excluding email delivery time.
- A character can recall an explicitly supplied durable preference in a new
  conversation.
- A deleted memory is no longer supplied to the model.
- Automated tests prove that messages and memories cannot cross user or
  character boundaries.
- Model timeout, provider rate limit, interrupted streaming, exhausted quota,
  exhausted instance budget, and memory-job failure have explicit,
  recoverable states.
- Account deletion removes messages, memories, summaries, and authentication
  data.

## 15. Deferred Decisions

The following require separate design work after the initial release:

- Paid plans and deployer billing
- User-created or public characters
- Voice and real-time multimodal interaction
- Native mobile applications
- Embedding-based memory retrieval
- Multi-model routing and fallback
- Community moderation and discovery
- Relationship progression or game mechanics
