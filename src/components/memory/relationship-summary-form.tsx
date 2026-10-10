"use client";

import { useActionState, useId, useState } from "react";
import type { RelationshipMemoryScreenView } from "@/server/memory/memory-queries";
import {
  idleMemoryState,
  MemoryFormStatus,
  type MemoryAction,
} from "./memory-form-state";

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
  const [baseRevision, setBaseRevision] = useState(view.summaryRevision);
  const [explicit, setExplicit] = useState(false);
  const [previousState, setPreviousState] = useState(state);
  const [previousRevision, setPreviousRevision] = useState(
    view.summaryRevision,
  );
  if (previousState !== state) {
    setPreviousState(state);
    if (state.status === "success") {
      setDraft(null);
      setExplicit(false);
    }
  }
  if (previousRevision !== view.summaryRevision) {
    setPreviousRevision(view.summaryRevision);
    if (view.summaryRevision === 0) {
      setDraft(null);
      setExplicit(false);
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
      <form action={action}>
        <input
          name="expectedRevision"
          type="hidden"
          value={
            draft !== null && state.status !== "conflict"
              ? baseRevision
              : view.summaryRevision
          }
        />
        <fieldset disabled={busy}>
          <label htmlFor={id}>Relationship summary</label>
          <textarea
            id={id}
            name="content"
            maxLength={4000}
            value={draft ?? view.summary?.content ?? ""}
            onChange={(event) => {
              if (draft === null) setBaseRevision(view.summaryRevision);
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
      <form action={regenerate}>
        <input
          name="expectedRevision"
          type="hidden"
          value={view.summaryRevision}
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
