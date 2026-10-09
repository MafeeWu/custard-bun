# Task 4 Report: Assemble Prompts Within Explicit Token Budgets

## Summary

Implemented a server-side prompt assembler that:

- reuses the exported `PublishedCharacterVersion` type;
- builds deterministic platform + character system messages;
- keeps user content as user-role content;
- includes example conversations before live history when budget permits;
- selects only complete current user/assistant turns;
- trims oldest complete turns first while preserving chronological output;
- reserves `maxOutputTokens` against the prompt budget; and
- throws `CHAT_VALIDATION` when mandatory prompt content cannot fit.

## Files changed

- `src/server/chat/prompt-assembler.ts`
- `src/server/chat/prompt-assembler.test.ts`
- `src/server/characters/character-queries.ts`

## TDD evidence

1. Red:
   - `pnpm vitest run src/server/chat/prompt-assembler.test.ts`
   - failed because `./prompt-assembler` did not exist.
2. Green:
   - `pnpm vitest run src/server/chat/prompt-assembler.test.ts`
   - passed after implementation.

## Verification

- `pnpm vitest run` → 83 files, 387 tests passed
- `pnpm typecheck` → passed
- `pnpm lint` → passed with 9 pre-existing warnings and 0 errors

## Commit

- `eed54a6` — `feat(chat): assemble bounded character prompts`

## Self-review

- No provider calls or database mutations were introduced.
- The assembler consumes only supplied history and token-counter estimates.
- Only current complete generated attempts can enter prompt history.
- The current user message is always appended as a user-role message.

## Fix Round 1

### Binding rulings applied

- Extended `assembleChatPrompt` input with explicit `userId` and `conversationId`.
- Filtered history by both identifiers before building complete user/assistant turns.
- Removed `shortDescription` and `longDescription` from the mandatory character system prompt.

### RED

- `pnpm vitest run src/server/chat/prompt-assembler.test.ts`
- Failed in two places before the fix:
  - `preserves precedence and keeps user text in a user-role message` threw `CHAT_VALIDATION` because the mandatory prompt still included description fields and overflowed the tighter budget.
  - `uses only the explicit current user and conversation history` selected a newer/longer foreign thread instead of the requested current thread.

### GREEN

- `pnpm vitest run src/server/chat/prompt-assembler.test.ts`
- Passed: `1 passed`, `6 passed`.

### Verification

- `pnpm typecheck` → passed
- `pnpm exec eslint src/server/chat/prompt-assembler.ts src/server/chat/prompt-assembler.test.ts` → passed

### Commit

- `fix(chat): isolate prompt history and trim character prompt`
