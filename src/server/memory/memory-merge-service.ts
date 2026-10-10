import "server-only";

import { randomUUID } from "node:crypto";
import { and, countDistinct, eq, or, sql } from "drizzle-orm";
import type { ChatTransaction } from "@/server/chat/chat-locks";
import { ChatDomainError } from "@/server/chat/chat-errors";
import {
  memoryEvidence,
  memoryExtractionRun,
  memoryItem,
  userCharacterMemorySetting,
} from "@/server/db/schema";
import {
  parseMemoryCandidates,
  type MemoryCandidate,
} from "./memory-contracts";
import {
  normalizeMemoryCandidate,
  normalizeMemoryText,
} from "./memory-normalization";
import {
  assertMemoryCandidateAllowed,
  isPersonalSensitiveMemory,
} from "./memory-policy";
import {
  lockExtractionRelationship,
  readExtractionSource,
} from "./memory-extraction-service";

function hasRememberIntent(content: string): boolean {
  if (
    /\b(?:not|never|don't|dont|do not)\b.{0,40}\b(?:remember|memorize)\b|不要记住|別記住|别记住/i.test(
      content,
    )
  ) {
    return false;
  }
  return /(?:^|[.!?\n])\s*(?:(?:please|can you|could you|i want you to|i would like you to)\s+)?(?:remember|memorize|keep (?:this|that) in mind)\b|(?:^|[。！？，\n])\s*(?:请|請)?(?:记住|記住)/i.test(
    content,
  );
}

function hasCandidateRememberIntent(
  userContent: string,
  candidateContent: string,
): boolean {
  const source = normalizeMemoryText(userContent).toLocaleLowerCase("en-US");
  if (!hasRememberIntent(source)) return false;
  const words =
    candidateContent
      .toLocaleLowerCase("en-US")
      .replace(/\bdiagnosed\b/g, "diagnosis")
      .match(/[\p{L}\p{N}]+/gu) ?? [];
  const generic = new Set([
    "i",
    "me",
    "my",
    "the",
    "a",
    "an",
    "that",
    "user",
    "users",
    "is",
    "am",
    "are",
    "has",
    "have",
    "had",
    "with",
    "of",
    "at",
    "in",
    "on",
    "for",
    "to",
    "medical",
    "condition",
    "lives",
    "practices",
    "takes",
  ]);
  const facts = words.filter((word) => !generic.has(word));
  if (!facts.length) return false;
  // Consent is scoped to the request clause, not other facts elsewhere in the turn.
  return userContent
    .split(/[.!?;。\n]|,\s*|\b(?:and|but|also)\b/i)
    .some((clause) => {
      const normalized = normalizeMemoryText(clause).toLocaleLowerCase("en-US");
      if (!hasRememberIntent(normalized)) return false;
      if (
        /\b(?:not|never|no|don't|dont|without)\b|不|没有|沒有/.test(normalized)
      )
        return false;
      const requested = new Set(
        normalized
          .replace(/\bdiagnosed\b/g, "diagnosis")
          .match(/[\p{L}\p{N}]+/gu) ?? [],
      );
      return facts.every((word) => requested.has(word));
    });
}

export function allowedExtractionCandidates(
  candidates: unknown,
  source: { sourceMessageId: string; userContent: string },
): MemoryCandidate[] {
  return parseMemoryCandidates(candidates).flatMap((raw) => {
    if (raw.sourceMessageId !== source.sourceMessageId) return [];
    if (raw.explicitness === "repeated_inference" && raw.type !== "preference")
      return [];
    try {
      const normalized = normalizeMemoryCandidate(raw);
      const sensitive =
        raw.sensitivity === "personal_explicit" ||
        isPersonalSensitiveMemory(normalized.content);
      const approved: MemoryCandidate = {
        ...raw,
        content: normalized.content,
        sensitivity: sensitive ? "personal_explicit" : "ordinary",
        userExplicitlyAskedToRemember: hasCandidateRememberIntent(
          source.userContent,
          normalized.content,
        ),
      };
      assertMemoryCandidateAllowed(normalizeMemoryCandidate(approved));
      return [approved];
    } catch (error) {
      if (error instanceof ChatDomainError && error.code === "CHAT_VALIDATION")
        return [];
      throw error;
    }
  });
}

export async function mergeMemoryCandidates(
  transaction: ChatTransaction,
  input: { runId: string; candidates: unknown; now: Date },
): Promise<{ applied: boolean; changedItems: number }> {
  const [preview] = await transaction
    .select()
    .from(memoryExtractionRun)
    .where(eq(memoryExtractionRun.id, input.runId))
    .limit(1);
  if (!preview) return { applied: false, changedItems: 0 };
  const settings = await lockExtractionRelationship(transaction, preview);
  const source = await readExtractionSource(transaction, preview);
  const [run] = await transaction
    .select()
    .from(memoryExtractionRun)
    .where(eq(memoryExtractionRun.id, input.runId))
    .for("update")
    .limit(1);
  if (
    !settings ||
    !source ||
    !run ||
    !["pending", "queued", "running", "retrying"].includes(run.status)
  ) {
    return { applied: false, changedItems: 0 };
  }
  const candidates = allowedExtractionCandidates(input.candidates, source);
  let changedItems = 0;
  for (const raw of candidates) {
    const candidate = normalizeMemoryCandidate(raw);
    const target = candidate.mergeTargetDigest ?? candidate.normalizedDigest;
    let [item] = await transaction
      .select()
      .from(memoryItem)
      .where(
        and(
          eq(memoryItem.userId, run.userId),
          eq(memoryItem.characterId, run.characterId),
          eq(memoryItem.memoryEpoch, run.memoryEpoch),
          eq(memoryItem.type, candidate.type),
          or(
            eq(memoryItem.normalizedDigest, target),
            eq(memoryItem.automaticDigest, target),
            eq(memoryItem.normalizedDigest, candidate.normalizedDigest),
          ),
        ),
      )
      .for("update")
      .limit(1);
    if (item?.origin === "user_edited") continue;
    if (!item) {
      [item] = await transaction
        .insert(memoryItem)
        .values({
          id: randomUUID(),
          userId: run.userId,
          characterId: run.characterId,
          memoryEpoch: run.memoryEpoch,
          type: candidate.type,
          content: candidate.content,
          normalizedContent: candidate.normalizedContent,
          normalizedDigest: candidate.normalizedDigest,
          automaticDigest: candidate.normalizedDigest,
          origin: "automatic",
          isActive: candidate.explicitness === "direct",
          sensitivity: candidate.sensitivity,
          explicitness: candidate.explicitness,
          confidence: Math.round(candidate.confidence),
          importance: Math.round(candidate.importance),
          firstObservedAt: source.observedAt,
          lastConfirmedAt: input.now,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .returning();
    }
    const inserted = await transaction
      .insert(memoryEvidence)
      .values({
        id: randomUUID(),
        memoryId: item.id,
        sourceMessageId: source.sourceMessageId,
        sourceAttemptId: run.generationAttemptId,
        observedAt: source.observedAt,
        evidenceKind:
          candidate.explicitness === "direct" ? "direct" : "supporting",
      })
      .onConflictDoNothing()
      .returning({ id: memoryEvidence.id });
    if (!inserted.length) continue;
    const [evidence] = await transaction
      .select({ sources: countDistinct(memoryEvidence.sourceMessageId) })
      .from(memoryEvidence)
      .where(eq(memoryEvidence.memoryId, item.id));
    await transaction
      .update(memoryItem)
      .set({
        confidence: Math.max(item.confidence, Math.round(candidate.confidence)),
        importance: Math.max(item.importance, Math.round(candidate.importance)),
        lastConfirmedAt: new Date(
          Math.max(item.lastConfirmedAt.getTime(), input.now.getTime()),
        ),
        isActive:
          item.isActive ||
          candidate.explicitness === "direct" ||
          evidence.sources >= 2,
        ...(candidate.explicitness === "direct"
          ? { explicitness: "direct" as const }
          : {}),
        revision: item.revision + 1,
        updatedAt: input.now,
      })
      .where(eq(memoryItem.id, item.id));
    changedItems++;
  }
  if (changedItems)
    await transaction
      .update(userCharacterMemorySetting)
      .set({
        memoryRevision: sql`${userCharacterMemorySetting.memoryRevision} + 1`,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(userCharacterMemorySetting.userId, run.userId),
          eq(userCharacterMemorySetting.characterId, run.characterId),
        ),
      );
  return { applied: true, changedItems };
}
