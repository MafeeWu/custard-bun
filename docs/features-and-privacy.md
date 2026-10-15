# Features and privacy

This document describes user-visible behavior and the privacy boundaries that
self-hosted operators must preserve.

## Clear Daylight interface

The Clear Daylight interface uses a light theme by default and follows the
system `prefers-color-scheme` setting for dark mode. Theme selection applies
before hydration, so there is no client-only flash or manual theme toggle.

The deployer-owned `branding.primaryColor` is the only accent input. Runtime
derivation provides readable button, link, soft-surface, active, hover, and
focus colors across light and dark surfaces.

Geist fonts and Phosphor icons are bundled locally. The production UI does not
fetch remote fonts or images. Motion follows `prefers-reduced-motion`, public
content remains visible without JavaScript, and dialog and drawer keyboard
behavior remains available with reduced motion.

## Characters and conversations

Anonymous visitors can browse `/characters` and public character details.
Only active characters with an explicitly selected published default version
are public.

Each conversation pins the immutable character version selected when it is
created:

- changing the default does not rewrite existing chats;
- **Start over** archives the current chat and uses the current default;
- archived chats are read-only and can be deleted independently; and
- deleting a chat does not automatically delete already-formed long-term
  memory.

Responses stream into the timeline. **Stop** keeps received partial text and
marks the attempt interrupted. Retry replaces the incomplete generated attempt
without duplicating the user's source message. Only one generation can run for
a user at a time.

Quota admission is transactional. Operators can set user daily request/token
limits, instance monthly budgets, and maximum concurrent generations. The
administration UI exposes aggregate counts, latency, outcomes, retry counts,
model IDs, and safe provider failure categories, never prompt or message text.

## Character administration

Administrators can:

- create characters with stable, permanent slugs;
- edit one mutable draft per character;
- preview the saved draft;
- publish immutable numbered versions;
- explicitly select the public default version; and
- archive or restore a character.

Publishing never automatically changes the default version. Archive hides a
character from new public selection but preserves drafts, versions, default
pointers, and existing conversations.

Avatar paths must be local files under `/characters/`. Remote URLs, traversal,
queries, and fragments are rejected. Never overwrite an avatar referenced by a
published version; add a new file and publish a new version.

Administrative changes are audited with operation IDs, actor labels, targets,
timestamps, and small safe metadata. Audit pages do not expose full character
packages, disable reasons, credentials, tokens, transcripts, or memory text.

## Long-term memory

Automatic memory extraction runs after eligible completed replies. Memory is
isolated by user, character, and relationship epoch. There is no historical
backfill.

Users can:

- view active memories and their origin, source count, and confirmation date;
- edit or delete memories;
- stop new automatic recording;
- independently stop memory and summary recall in chat;
- edit, clear, or explicitly regenerate a relationship summary; and
- **Forget character**, which removes memory, evidence, and summary history
  while keeping conversation transcripts.

User edits are authoritative and cannot be silently overwritten by automatic
extraction. Capacity limits fail explicitly instead of silently evicting or
truncating existing items.

Credential-class content is rejected. Known sensitive facts require an
explicit, sentence-scoped request to remember a complete first-person fact.
Provider labels alone are never treated as consent. Memory candidates and
summaries are normalized and validated locally before durable application.

Recall is inserted into prompts as quoted, untrusted background data after
platform and character instructions. Mandatory chat input and reserved output
always take priority over the memory token budget.

## Data exports

The account privacy page can request an asynchronous ZIP containing versioned
JSON for the owner's safe profile fields, conversations, messages, memories,
evidence, summaries, relationship controls, effective quotas, user-facing
usage, and relevant audit actions.

Exports exclude:

- credentials, sessions, verification values, and recovery candidates;
- provider keys, endpoints, and identities;
- internal queue, retry, reservation, and operation payloads;
- private audit metadata; and
- every other user's data.

Archive bytes are stored in PostgreSQL, not on application disk or in queue
payloads. SHA-256 and size are checked again at download. Downloads require the
current owner, use `private, no-store`, and expire 24 hours after final archive
publication. Expiry physically removes the bytes.

Downloaded archives contain private product data and must be handled securely.

## Account deletion

Account deletion requires an application-owned verification email. The
one-hour, single-use token is stored only as a hash and is carried in the URL
fragment rather than an access-log query string.

Confirmation immediately:

- revokes sessions and locks further access;
- cancels or settles chat and background work;
- removes completed export bytes;
- advances memory relationship epochs; and
- records a restartable purge request.

The worker then purges exports, memory, summaries, conversations, attempts,
user-specific audit/authentication data, and the user in independently
restartable stages. De-identified numeric accounting totals and required audit
counts can remain; private content and credentials do not.

Repeated stage failure creates an ID-only dead letter that operators can retry
from aggregate administration tools. A dead letter is an alert, not a claim
that deletion succeeded.

Application deletion cannot erase external provider retention or independent
backups. Operators must document those policies separately.

## Account and administration safety

Disabling an ordinary account requires a reason and confirmation, revokes all
sessions, and rejects later sign-in. Restoring access does not restore old
sessions. Administrators cannot disable themselves or other administrators
through the web controls.

Protected services re-check the current account and role at the write boundary;
stale or forged actor objects do not authorize changes after demotion,
disablement, or pending deletion.

Administrative pages are aggregate-only by design. They do not provide private
message, memory, summary, export, or raw provider-body inspection.

## Detailed design references

Implementation invariants and concurrency decisions are documented in:

- [Streaming chat, model gateway, and quotas](superpowers/specs/2026-10-09-streaming-chat-model-gateway-and-quotas-design.md)
- [Official characters and administration](superpowers/specs/2026-10-08-official-characters-and-administration-design.md)
- [Long-term memory, privacy, and operations](superpowers/specs/2026-10-10-long-term-memory-privacy-and-operations-design.md)
- [Self-hosted operations and release lifecycle](superpowers/specs/2026-10-12-self-hosted-operations-and-release-lifecycle-design.md)
- [Clear Daylight interface redesign](superpowers/specs/2026-10-13-clear-daylight-interface-redesign.md)
