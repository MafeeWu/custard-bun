"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import type {
  MemorySyncStatus,
  RelationshipMemoryScreenView,
} from "@/server/memory/memory-queries";
import { Button, LinkButton } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatusNotice } from "@/components/ui/status-notice";
import { Surface } from "@/components/ui/surface";
import { MemoryControlsForm } from "./memory-controls-form";
import { ForgetCharacterForm } from "./forget-character-form";
import { MemoryItemList } from "./memory-item-list";
import {
  idleMemoryState,
  MemoryFormStatus,
  type MemoryAction,
} from "./memory-form-state";
import { MemoryStatus } from "./memory-status";
import { RelationshipSummaryForm } from "./relationship-summary-form";

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
    <li className="memory-sync-item">
      <div className="memory-sync-item__row">
        <div>
          <p className="memory-sync-item__label">Automatic memory extraction</p>
          <p className="memory-sync-item__value">
            {statusCopy[extraction.status]}
          </p>
        </div>
        {extraction.status === "needs_retry" && extraction.canRetry ? (
          <form action={action} className="memory-sync-item__actions">
            <input name="runId" type="hidden" value={extraction.id} />
            <Button type="submit" disabled={pending}>
              {pending ? "Requesting…" : "Retry extraction"}
            </Button>
            <MemoryFormStatus state={state} />
          </form>
        ) : null}
      </div>
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
  const summaryPresent = Boolean(view.summary?.content);
  const allSynced = !view.extractions.length && view.summaryStatus === "synced";

  return (
    <div className="memory-page">
      <PageHeader
        actions={
          <div className="memory-buttons memory-page__header-actions">
            <LinkButton href="/app/memories" size="sm" tone="secondary">
              All character memories
            </LinkButton>
            <LinkButton
              href={
                view.conversationId
                  ? `/app/conversations/${view.conversationId}`
                  : "/app"
              }
              size="sm"
              tone="quiet"
            >
              {view.conversationId ? "Back to chat" : "Back to conversations"}
            </LinkButton>
          </div>
        }
        description="Automatic memories are active immediately. You can edit or remove them at any time."
        eyebrow="Privacy & memory"
        title={`${view.character.displayName}’s memory`}
      />

      <div className="memory-page__layout">
        <div className="memory-page__primary">
          <Surface
            as="section"
            aria-labelledby="memory-overview-heading"
            className="memory-card"
            padding="lg"
            tone="raised"
          >
            <div className="memory-section-heading">
              <div>
                <h2 id="memory-overview-heading">Memory overview</h2>
                <p>
                  Review saved memories, whether they can be used in chat, and
                  whether a relationship summary is present.
                </p>
              </div>
            </div>
            <MemoryStatus
              activeItems={view.items.length}
              recallEnabled={view.settings.usageEnabled}
              recordingEnabled={view.settings.recordingEnabled}
              summaryPresent={summaryPresent}
            />
          </Surface>

          <Surface
            as="section"
            aria-labelledby="memory-items-heading"
            className="memory-card"
            padding="lg"
            tone="raised"
          >
            <div className="memory-section-heading">
              <div>
                <h2 id="memory-items-heading">Saved memories</h2>
                <p>
                  Automatic and edited memories stay separate from your
                  transcripts.
                </p>
              </div>
            </div>
            <MemoryItemList
              deleteAction={actions.deleteMemory}
              editAction={actions.editMemory}
              items={view.items}
            />
          </Surface>

          <RelationshipSummaryForm
            view={view}
            editAction={actions.summary}
            regenerateAction={actions.regenerate}
          />
        </div>

        <div className="memory-page__secondary">
          <Surface
            as="section"
            aria-labelledby="memory-controls-heading"
            className="memory-card"
            padding="lg"
            tone="subtle"
          >
            <div className="memory-section-heading">
              <div>
                <h2 id="memory-controls-heading">Recording & recall</h2>
                <p>
                  These controls change future memory updates without changing
                  past chats.
                </p>
              </div>
            </div>
            <MemoryControlsForm
              settings={view.settings}
              action={actions.controls}
            />
          </Surface>

          <Surface
            as="section"
            aria-labelledby="memory-sync-heading"
            className="memory-card"
            padding="lg"
            tone="default"
          >
            <div className="memory-section-heading">
              <div>
                <h2 id="memory-sync-heading">Memory synchronization</h2>
                <p>
                  Check whether automatic extraction or summary generation still
                  needs work.
                </p>
              </div>
            </div>
            {allSynced ? (
              <StatusNotice title="Synced" tone="success">
                Memory and summary are up to date.
              </StatusNotice>
            ) : (
              <div aria-live="polite" role="status">
                <ul className="memory-sync-list">
                  {view.extractions.map((row) => (
                    <ExtractionStatus
                      key={row.id}
                      extraction={row}
                      retry={actions.retry}
                    />
                  ))}
                  <li className="memory-sync-item">
                    <div className="memory-sync-item__row">
                      <div>
                        <p className="memory-sync-item__label">
                          Relationship summary
                        </p>
                        <p className="memory-sync-item__value">
                          {statusCopy[view.summaryStatus]}
                        </p>
                      </div>
                    </div>
                  </li>
                </ul>
              </div>
            )}
          </Surface>
        </div>
      </div>

      <ForgetCharacterForm
        revision={view.settings.revision}
        action={actions.forget}
      />
    </div>
  );
}
