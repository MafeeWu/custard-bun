"use client";

import { useActionState, useId, useState } from "react";
import type { RelationshipMemoryScreenView } from "@/server/memory/memory-queries";
import {
  idleMemoryState,
  MemoryFormStatus,
  useMemoryRevision,
  type MemoryAction,
} from "./memory-form-state";

type SummaryRevision = { memoryEpoch: number; revision: number };
function sameSummaryRevision(left: SummaryRevision, right: SummaryRevision) {
  return (
    left.memoryEpoch === right.memoryEpoch && left.revision === right.revision
  );
}

export function RelationshipSummaryForm({
  view,
  editAction,
  regenerateAction,
}: {
  view: RelationshipMemoryScreenView;
  editAction: MemoryAction;
  regenerateAction: MemoryAction;
}) {
  const [state, action, pending] = useActionState(editAction, idleMemoryState);
  const [regenState, regenerate, regenerating] = useActionState(
    regenerateAction,
    idleMemoryState,
  );
  const [draft, setDraft] = useState<string | null>(null);
  const currentRevision = {
    memoryEpoch: view.summaryEpoch,
    revision: view.summaryRevision,
  };
  const baseRevision = useMemoryRevision(
    currentRevision,
    state,
    sameSummaryRevision,
  );
  const regenRevision = useMemoryRevision(
    currentRevision,
    regenState,
    sameSummaryRevision,
  );
  const [explicit, setExplicit] = useState(false);
  const [previousState, setPreviousState] = useState(state);
  const [previousRevision, setPreviousRevision] = useState(currentRevision);
  if (previousState !== state) {
    setPreviousState(state);
    if (state.status === "success") {
      setDraft(null);
      setExplicit(false);
    }
  }
  if (!sameSummaryRevision(previousRevision, currentRevision)) {
    setPreviousRevision(currentRevision);
    if (view.summaryRevision === 0) {
      setDraft(null);
      setExplicit(false);
      baseRevision.reset();
      regenRevision.reset();
    }
  }
  const id = useId();
  const busy = pending || regenerating;
  return (
    <section aria-label="Summary management" className="memory-card">
      <h2>Relationship summary</h2>
      <p className="memory-content">
        {view.summary?.content || "No relationship summary yet."}
      </p>
      {view.summary ? (
        <p>
          {view.summary.origin === "user_edited"
            ? "Edited by you"
            : "Automatic"}{" "}
          · Updated{" "}
          <time dateTime={view.summary.updatedAt.toISOString()}>
            {view.summary.updatedAt.toISOString().slice(0, 10)}
          </time>
        </p>
      ) : null}
      <form action={action} onSubmit={baseRevision.beginSubmission}>
        <input
          name="expectedRevision"
          type="hidden"
          value={baseRevision.revision.revision}
        />
        <input
          name="expectedMemoryEpoch"
          type="hidden"
          value={baseRevision.revision.memoryEpoch}
        />
        <fieldset disabled={busy}>
          <label htmlFor={id}>Relationship summary</label>
          <textarea
            id={id}
            name="content"
            maxLength={4000}
            value={draft ?? view.summary?.content ?? ""}
            onChange={(event) => {
              if (draft === null) baseRevision.capture();
              setDraft(event.target.value);
            }}
          />
          <label>
            <input
              type="checkbox"
              name="explicitIntent"
              checked={explicit}
              onChange={(event) => setExplicit(event.target.checked)}
            />{" "}
            I explicitly want to remember this summary, including any sensitive
            personal details.
          </label>
          <p>
            Credentials cannot be saved. Edited or cleared summaries remain
            authoritative until you explicitly regenerate.
          </p>
          <div className="memory-buttons">
            <button
              type="submit"
              name="operation"
              value="edit"
              disabled={!explicit}
            >
              {pending ? "Saving…" : "Save summary"}
            </button>
            <button type="submit" name="operation" value="clear">
              Clear summary
            </button>
          </div>
        </fieldset>
        <MemoryFormStatus state={state} />
      </form>
      <form action={regenerate} onSubmit={regenRevision.beginSubmission}>
        <input
          name="expectedRevision"
          type="hidden"
          value={regenRevision.revision.revision}
        />
        <input
          name="expectedMemoryEpoch"
          type="hidden"
          value={regenRevision.revision.memoryEpoch}
        />
        <p>
          Regenerate replaces your summary with a new automatic summary based on
          current memory.
        </p>
        <button
          type="submit"
          disabled={
            busy ||
            !view.settings.recordingEnabled ||
            view.summaryStatus === "processing" ||
            view.summaryStatus === "retrying"
          }
        >
          {regenerating ? "Requesting…" : "Regenerate summary"}
        </button>
        <MemoryFormStatus state={regenState} />
      </form>
    </section>
  );
}
