import type { RelationshipMemoryScreenView } from "@/server/memory/memory-queries";

export function memoryScreenFixture(): RelationshipMemoryScreenView {
  return {
    character: { id: "character-1", displayName: "Mira" },
    settings: { recordingEnabled: true, usageEnabled: true, revision: 1 },
    items: [
      {
        id: "memory-1",
        type: "preference",
        content: "Likes green tea.",
        origin: "automatic",
        sensitivity: "ordinary",
        explicitness: "direct",
        lastConfirmedAt: new Date("2026-10-10T00:00:00Z"),
        supportingSourceCount: 2,
        revision: 1,
      },
    ],
    summary: {
      content: "We talk about tea.",
      origin: "automatic",
      revision: 2,
      updatedAt: new Date("2026-10-10T00:00:00Z"),
    },
    summaryRevision: 2,
    summaryEpoch: 0,
    extractions: [{ id: "run-1", status: "needs_retry", canRetry: true }],
    summaryStatus: "synced",
    conversationId: "conversation-1",
  };
}
