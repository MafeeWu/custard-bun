import { eq } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { relationshipSummaryRun } from "@/server/db/schema";
import { createExtractionRunForCompletedAttempt } from "@/server/memory/memory-extraction-service";
import { mergeMemoryCandidates } from "@/server/memory/memory-merge-service";
import {
  extractionAttempt,
  extractionCandidate,
  extractionFixture,
  extractionNow,
} from "./memory-extraction-fixture";

export async function summaryFixture(database: Database) {
  const fixture = await extractionFixture(database);
  const attempt = await extractionAttempt(database, fixture);
  await database.transaction(async (tx) => {
    const run = await createExtractionRunForCompletedAttempt(tx, {
      ...fixture,
      ...attempt,
      now: extractionNow,
    });
    await mergeMemoryCandidates(tx, {
      runId: run!.runId,
      candidates: [extractionCandidate(attempt.sourceMessageId)],
      now: extractionNow,
    });
  });
  const [run] = await database
    .select()
    .from(relationshipSummaryRun)
    .where(eq(relationshipSummaryRun.userId, fixture.userId));
  return { ...fixture, ...attempt, operationId: run?.id };
}

export function summaryResult(summary: unknown = "Enjoys green tea.") {
  return {
    content: JSON.stringify({ summary }),
    modelId: "test-model",
    providerRequestIds: ["private-summary-provider-id"],
    inputTokens: 13,
    outputTokens: 7,
    latencyMs: 10,
  };
}
