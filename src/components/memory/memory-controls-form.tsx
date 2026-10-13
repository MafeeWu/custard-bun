"use client";

import { useActionState, useState } from "react";
import type { RelationshipMemoryScreenView } from "@/server/memory/memory-queries";
import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/field";
import {
  idleMemoryState,
  MemoryFormStatus,
  useMemoryRevision,
  type MemoryAction,
} from "./memory-form-state";

export function MemoryControlsForm({
  settings,
  action: update,
}: {
  settings: RelationshipMemoryScreenView["settings"];
  action: MemoryAction;
}) {
  const [state, action, pending] = useActionState(update, idleMemoryState);
  const [recording, setRecording] = useState<boolean | null>(null);
  const [usage, setUsage] = useState<boolean | null>(null);
  const baseRevision = useMemoryRevision(settings.revision, state);
  const [previousState, setPreviousState] = useState(state);
  if (previousState !== state) {
    setPreviousState(state);
    if (state.status === "success") {
      setRecording(null);
      setUsage(null);
    }
  }
  return (
    <form
      action={action}
      className="memory-form"
      onSubmit={baseRevision.beginSubmission}
    >
      <input
        name="expectedRevision"
        type="hidden"
        value={baseRevision.revision}
      />
      <fieldset disabled={pending}>
        <legend>Recording & recall</legend>
        <p className="memory-form__lead">
          Current settings:{" "}
          {settings.recordingEnabled ? "Recording on" : "Recording stopped"};{" "}
          {settings.usageEnabled ? "Chat usage on" : "Chat usage stopped"}.
        </p>
        <CheckboxField
          checked={recording ?? !settings.recordingEnabled}
          label="Stop recording"
          name="stopRecording"
          onChange={(event) => {
            if (recording === null && usage === null) baseRevision.capture();
            setRecording(event.target.checked);
          }}
        />
        <p>
          Stops new automatic memories and cancels pending extraction. Existing
          memory is kept.
        </p>
        <CheckboxField
          checked={usage ?? !settings.usageEnabled}
          label="Stop using in chat"
          name="stopUsage"
          onChange={(event) => {
            if (recording === null && usage === null) baseRevision.capture();
            setUsage(event.target.checked);
          }}
        />
        <p>
          Stops memory and summary recall in future chat prompts. Recording is
          controlled separately. Replies already started may use their existing
          prompt.
        </p>
        <div className="memory-form__actions">
          <Button type="submit">{pending ? "Saving…" : "Save controls"}</Button>
        </div>
      </fieldset>
      <MemoryFormStatus state={state} />
    </form>
  );
}
