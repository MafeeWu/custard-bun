"use client";

import { ArrowsClockwise, Sparkle } from "@phosphor-icons/react";
import { useActionState, useId, useState } from "react";
import type { RelationshipMemoryScreenView } from "@/server/memory/memory-queries";
import { Button } from "@/components/ui/button";
import { CheckboxField, Field, Textarea } from "@/components/ui/field";
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
      <div className="memory-section-heading">
        <div>
          <h2>Relationship summary</h2>
          <p>
            {view.summary
              ? "Review, edit, clear, or regenerate the high-level relationship summary."
              : "No relationship summary yet. Add one manually or wait for future memory updates."}
          </p>
        </div>
      </div>
      <p className="memory-content">
        {view.summary?.content || "No relationship summary yet."}
      </p>
      {view.summary ? (
        <p className="memory-summary__meta">
          <Sparkle aria-hidden="true" size={18} weight="bold" />
          <span>
            {view.summary.origin === "user_edited"
              ? "Edited by you"
              : "Automatic"}{" "}
            · Updated{" "}
            <time dateTime={view.summary.updatedAt.toISOString()}>
              {view.summary.updatedAt.toISOString().slice(0, 10)}
            </time>
          </span>
        </p>
      ) : null}
      <form
        action={action}
        className="memory-form"
        onSubmit={baseRevision.beginSubmission}
      >
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
          <Field
            hint="Credentials cannot be saved. Edited or cleared summaries remain authoritative until you explicitly regenerate."
            htmlFor={id}
            label="Relationship summary"
          >
            <Textarea
              id={id}
              maxLength={4000}
              name="content"
              value={draft ?? view.summary?.content ?? ""}
              onChange={(event) => {
                if (draft === null) baseRevision.capture();
                setDraft(event.target.value);
              }}
            />
          </Field>
          <CheckboxField
            checked={explicit}
            label="I explicitly want to remember this summary, including any sensitive personal details."
            name="explicitIntent"
            onChange={(event) => setExplicit(event.target.checked)}
          />
          <div className="memory-form__actions">
            <Button
              disabled={!explicit}
              type="submit"
              value="edit"
              name="operation"
            >
              {pending ? "Saving…" : "Save summary"}
            </Button>
            <Button
              name="operation"
              tone="secondary"
              type="submit"
              value="clear"
            >
              Clear summary
            </Button>
          </div>
        </fieldset>
        <MemoryFormStatus state={state} />
      </form>
      <form
        action={regenerate}
        className="memory-form memory-form--subtle"
        onSubmit={regenRevision.beginSubmission}
      >
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
        <div className="memory-form__actions">
          <Button
            disabled={
              busy ||
              !view.settings.recordingEnabled ||
              view.summaryStatus === "processing" ||
              view.summaryStatus === "retrying"
            }
            tone="secondary"
            type="submit"
          >
            <ArrowsClockwise aria-hidden="true" size={18} weight="bold" />
            {regenerating ? "Requesting…" : "Regenerate summary"}
          </Button>
        </div>
        <MemoryFormStatus state={regenState} />
      </form>
    </section>
  );
}
