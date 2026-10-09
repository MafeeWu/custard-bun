# Final whole-branch repair report

## Final review repair wave

Scope: all eight requested findings, including the previously deferred Minor.
The approved specification, implementation plan, and progress ledger were read
first. Work was performed directly in `feat/phase-3-streaming-chat`; no agents
or reviewers were spawned.

### Repairs and regression evidence

1. **Administrator/admission lock order:** global settings precedes actor/target
   user locks in settings update, reset, and disable. Authorization is still
   rechecked inside each write transaction. Three separate-connection PostgreSQL
   tests observed settings contention and reproduced PostgreSQL `40P01`
   deadlocks RED, then completed GREEN.
2. **Checkpoint/expiry lock order:** admission no longer prelocks an existing
   lease. Reconciliation and checkpoints acquire attempt then lease, reread
   expiry under those locks, and admission rereads the surviving user lease.
   A staged real checkpoint holding the attempt reproduced a deadlock RED;
   after repair its refreshed lease remains active and admission returns the
   documented generation-in-progress error GREEN.
3. **Production read recovery:** both existing-conversation open and owned
   detail queries reconcile only that authenticated owner/conversation before
   returning. Query regressions went RED→GREEN. Wrong-owner reads, another owned
   conversation, and fresh leases leave accounting untouched. Browser evidence
   loads a crashed leased partial through the actual conversation page.
4. **Durable output accounting:** checkpoints and final flushes persist a safe
   output estimate; recovery also tokenizes persisted partials for legacy
   checkpoints. Provider usage remains authoritative and is persisted while
   streaming. Expiry/account deletion charge nonzero output once, release unused
   headroom, and retain de-identified numeric usage. Prior zero-output assertions
   were corrected and observed RED→GREEN.
5. **Independent 500 ms durability:** one deferred timer is armed only for
   unpersisted output. Timer/chunk checkpoints share a serialization queue;
   finalization drains it and cancels the timer on every exit. Attempt-owner and
   nonterminal guards prevent writes after external settlement. Deterministic
   clock/scheduler tests use real PostgreSQL while the gateway is stalled,
   covering expiry, deletion, known provider usage, and completion.
6. **DONE termination:** SSE parsing returns immediately after the complete
   sentinel and closes its upstream iterator/body. LF, CRLF, CR, fragmented
   delimiters, and a loopback HTTP response deliberately left open are covered;
   original behavior requested another chunk or timed out RED, now GREEN.
7. **Composer idempotency:** an ambiguous submission retains its exact body/key
   until authoritative admission/rejection or a terminal event. Unchanged drafts
   and retries reuse it; edits/new submissions receive new keys. Terminal replay
   refreshes the authoritative transcript, and refreshed server messages replace
   stale local state. Component regressions cover network, empty/truncated
   stream, proxy/untyped error, changed draft, rejection, retry, and replay.
   Actual-browser evidence loses an already completed response, resends through
   the real composer, and proves one user turn/provider call/ledger charge.
8. **Mixed-case Markdown links:** external classification uses parsed protocol.
   Mixed-case HTTP(S) links now receive `_blank` and `noopener noreferrer`;
   both cases were observed RED→GREEN.

README and the directly conflicting lock-order documentation were updated.
Public errors, owner scoping, server-only credentials, and append-only
exactly-once accounting remain intact; no schema/dependency change is required.

### Verification

Focused PostgreSQL/gateway/component gate: **11 files, 157/157 passed**.
Actual composer/crash-recovery browser regression: **1/1 passed**.
Existing chat lifecycle browser regression: **1/1 passed**.

The first targeted browser run exposed an ambiguous alert selector because Next
also renders a route-announcer alert. It was scoped to the actual Conversation
region and rerun successfully; no application behavior was weakened.

The first full Vitest gate was **571/572**: the conversation page test's existing
`next/navigation` mock omitted the router now used for authoritative replay
refresh. The fixture was extended, without replacing the real chat components
or weakening assertions. The full gate is being rerun from frozen install.

The second full gate passed **572/572 Vitest tests**, typecheck, lint, and build.
Its browser gate was **11/12**: the added scenario's extra account login exhausted
the shared loopback login throttle before the existing chat scenario signed in.
The retained browser failure showed the actual “Too many attempts” alert.
The new evidence now runs within the existing chat scenario using its already
authenticated session. No production throttle is weakened and no sleep or
rate-limit-table reset is added to bypass the issue.

### Final full release gate

All Task 10 commands were executed in the prescribed order with explicit
loopback PostgreSQL `companion_test` on port 55432 for both `DATABASE_URL` and
`TEST_DATABASE_URL`, and test-only model/mail configuration:

| Gate | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Exit 0; manifests and lockfile unchanged |
| `pnpm db:test:up` | PostgreSQL and Mailpit healthy |
| `pnpm db:deploy` | Exit 0; migration and seeds applied |
| `pnpm test` | **101 files, 572/572 passed** |
| `pnpm typecheck` | Exit 0 |
| `pnpm lint` | Exit 0; 0 errors, 9 pre-existing warnings |
| `pnpm build` | Exit 0, including TypeScript 7 preflight |
| `pnpm db:deploy` | Exit 0; redeployed before browser tests |
| `pnpm test:e2e` | **11/11 passed**, including actual composer replay and page crash recovery |
| `pnpm db:generate` | No schema changes |
| `git diff --exit-code -- drizzle` | Exit 0 |
| `git diff --check` | Exit 0 |
| `pnpm exec tsc --version` | `Version 7.0.2` |
| TypeScript compatibility API import | `6.0.3` |

Full command output is retained alongside this report in
`final-release-gate.log`; earlier failed gate evidence is preserved in
`final-release-gate-first-attempt.log` and
`final-release-gate-second-attempt.log`. Focused output is in
`final-focused-gate.log`.

No production security/privacy contract or authentication throttle was weakened.
The previously running shared PostgreSQL/Mailpit stack was left running.

Fix commit: `925bb7a` — `feat/phase-3-streaming-chat fix: repair chat races and durable recovery`.
Unresolved requested findings: **none**. The deferred Markdown Minor is fixed.
