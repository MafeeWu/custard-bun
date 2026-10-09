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

## Authorized targeted repair

The user authorized one exceptional repair for the residual Important live
idempotency-replay blocker. Only that recovery path and its regression evidence
were changed; no subagent or reviewer was launched.

### Defect and repair

An admitted response lost before `started` correctly retained its submission
body/key, but an identical resend during generation installed a permanent
same-conversation conflict block. No authoritative attempt read subsequently
cleared that block.

- Same-conversation in-progress replay now enters transcript recovery instead
  of the unchanged other-conversation conflict/navigation state.
- Recovery uses the existing owner-scoped page refresh/query path. It creates
  no generation request, key, provider call, reservation, or charge.
- The composer remains disabled until the recovered authoritative attempt is
  terminal. Persisted snapshots replace the timeline, preserving partial and
  terminal content without adding optimistic duplicate bubbles.
- Stop is offered only after an authoritative attempt identity is available.
  A locally acknowledged stop does not end recovery prematurely: its final
  durable flush must still arrive through an authoritative snapshot.
- Refreshes run immediately and then every five seconds, capped at 181 reads
  over fifteen minutes (maximum generation timeout plus lease lifetime).
  Exhaustion exposes an explicit refresh action instead of polling forever.
  Terminal snapshots and unmount cancel scheduled refreshes; late stream and
  request completions cannot update unmounted state.

No API, schema, dependency, provider, quota, or authentication contract changed.

### Deterministic and real-browser evidence

The component reproduction observed RED on the original implementation: after
pre-start loss and identical resend, no durable partial, recovered stop control,
or bounded recovery action appeared. The repaired tests cover authoritative
completion, failure, interruption, bounded polling/manual refresh, stop/final
flush, cancellation on unmount, and ignored late stream events.

The existing authenticated browser scenario now also uses the **actual
composer** with a controlled live fake-provider response. Its first admitted
response is hidden from the browser before `started`; the identical resend gets
409 in-progress replay. Read recovery displays persisted partial content, then
automatically displays terminal content and re-enables the composer after
explicit provider completion. Assertions prove **one provider call, one user
turn, one ledger charge/request unit**, identical resend bodies, no duplicate
bubbles, and a subsequent genuinely new submission with a new key.

The first browser assertion deadline equaled the five-second refresh interval;
the trace showed terminal recovery arriving at that deadline. The assertion
now allows one polling cycle plus rendering. Subsequent focused setup attempts
exposed the full Vitest fixture's missing official-character seeds and retained
seven-request quota. `db:deploy` restored seeds; the normal full browser suite
restored deployment quotas through its existing administrator setup. No
production limit, login throttle, test assertion, or application behavior was
weakened to bypass these fixture conditions.

### Final verification

All final commands exited 0 against explicit loopback PostgreSQL
`companion_test` on port 55432 and test-only model/mail configuration.

| Gate | Result |
| --- | --- |
| Focused composer/screen/conversation-page Vitest | **3 files, 30/30 passed** |
| Full `pnpm test` | **101 files, 578/578 passed** |
| `pnpm typecheck` | Passed |
| `pnpm lint` | 0 errors; 9 unchanged pre-existing warnings |
| `pnpm db:deploy` before browser gate | Passed |
| Full `pnpm test:e2e` | **11/11 passed**, including live composer replay recovery |
| Standalone `pnpm build` | Passed, including TypeScript preflight |
| Modified-source Prettier check | Passed |
| `git diff --check` | Passed |
| Manifest/lockfile/schema diff check | No changes |

Raw command evidence is retained beside this report in
`authorized-repair-red.log`, `authorized-repair-focused.log`,
`authorized-repair-vitest.log`, `authorized-repair-static.log`,
`authorized-repair-db-deploy.log`, `authorized-repair-playwright.log`, and
`authorized-repair-build.log`. Earlier browser fixture/deadline failures remain
in the corresponding `authorized-repair-browser-*.log` files.

Authorized residual blocker: **fixed and verified**. The shared existing
PostgreSQL/Mailpit stack remains running.
