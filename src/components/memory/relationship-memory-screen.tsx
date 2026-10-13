"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import type {
  MemorySyncStatus,
  RelationshipMemoryScreenView,
} from "@/server/memory/memory-queries";
import { MemoryControlsForm } from "./memory-controls-form";
import { MemoryItemForm } from "./memory-item-form";
import { RelationshipSummaryForm } from "./relationship-summary-form";
import { ForgetCharacterForm } from "./forget-character-form";
import {
  idleMemoryState,
  MemoryFormStatus,
  type MemoryAction,
} from "./memory-form-state";

export interface MemoryScreenActions {
  editMemory: MemoryAction;
  deleteMemory: MemoryAction;
  controls: MemoryAction;
  summary: MemoryAction;
  regenerate: MemoryAction;
  forget: MemoryAction;
  retry: MemoryAction;
}
const statusCopy: Record<MemorySyncStatus, string> = {
  synced: "Synced",
  processing: "Processing",
  retrying: "Retrying",
  needs_retry: "Needs retry",
};

function ExtractionStatus({
  extraction,
  retry,
}: {
  extraction: RelationshipMemoryScreenView["extractions"][number];
  retry: MemoryAction;
}) {
  const [state, action, pending] = useActionState(retry, idleMemoryState);
  return (
    <li>
      <span>{statusCopy[extraction.status]}</span>
      {extraction.status === "needs_retry" && extraction.canRetry ? (
        <form action={action}>
          <input name="runId" type="hidden" value={extraction.id} />
          <button type="submit" disabled={pending}>
            {pending ? "Requesting…" : "Retry extraction"}
          </button>
          <MemoryFormStatus state={state} />
        </form>
      ) : null}
    </li>
  );
}

export function RelationshipMemoryScreen({
  view,
  actions,
}: {
  view: RelationshipMemoryScreenView;
  actions: MemoryScreenActions;
}) {
  const router = useRouter();
  const processing =
    view.extractions.some(
      (row) => row.status === "processing" || row.status === "retrying",
    ) ||
    view.summaryStatus === "processing" ||
    view.summaryStatus === "retrying";
  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [processing, router]);
  return (
    <div className="memory-page">
      <header>
        <p className="character-eyebrow">Privacy & memory</p>
        <h1>{view.character.displayName}’s memory</h1>
        <nav aria-label="Memory navigation" className="memory-buttons">
          <Link href="/app/memories">All character memories</Link>
          {view.conversationId ? (
            <Link href={`/app/conversations/${view.conversationId}`}>
              Back to chat
            </Link>
          ) : (
            <Link href="/app">Back to conversations</Link>
          )}
        </nav>
      </header>
      <p>
        Automatic memories are active immediately. You can edit or remove them
        at any time.
      </p>
      <div className="memory-card">
        <MemoryControlsForm
          settings={view.settings}
          action={actions.controls}
        />
      </div>
      <section aria-label="Memory synchronization" className="memory-card">
        <h2>Memory status</h2>
        <div role="status" aria-live="polite">
          {view.extractions.length ? (
            <ul>
              {view.extractions.map((row) => (
                <ExtractionStatus
                  key={row.id}
                  extraction={row}
                  retry={actions.retry}
                />
              ))}
            </ul>
          ) : (
            <p>Synced</p>
          )}
          <p>
            Summary: <span>{statusCopy[view.summaryStatus]}</span>
          </p>
        </div>
      </section>
      <section aria-label="Saved memories">
        <h2>Saved memories</h2>
        {view.items.length ? (
          <div className="memory-grid">
            {view.items.map((item) => (
              <MemoryItemForm
                key={item.id}
                item={item}
                editAction={actions.editMemory}
                deleteAction={actions.deleteMemory}
              />
            ))}
          </div>
        ) : (
          <p>No saved memories for this character.</p>
        )}
      </section>
      <RelationshipSummaryForm
        view={view}
        editAction={actions.summary}
        regenerateAction={actions.regenerate}
      />
      <ForgetCharacterForm
        revision={view.settings.revision}
        action={actions.forget}
      />
    </div>
  );
}
