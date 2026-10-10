"use client";

import { useActionState, useState } from "react";
import type { RelationshipMemoryScreenView } from "@/server/memory/memory-queries";
import {
  idleMemoryState,
  MemoryFormStatus,
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
  const [baseRevision, setBaseRevision] = useState(settings.revision);
  const [previousState, setPreviousState] = useState(state);
  if (previousState !== state) {
    setPreviousState(state);
    if (state.status === "success") {
      setRecording(null);
      setUsage(null);
    }
  }
  return (
    <form action={action}>
      <input
        name="expectedRevision"
        type="hidden"
        value={
          (recording !== null || usage !== null) && state.status !== "conflict"
            ? baseRevision
            : settings.revision
        }
      />
      <fieldset disabled={pending}>
        <legend>Memory controls</legend>
        <p>
          Current settings:{" "}
          {settings.recordingEnabled ? "Recording on" : "Recording stopped"};{" "}
          {settings.usageEnabled ? "Chat usage on" : "Chat usage stopped"}.
        </p>
        <label>
          <input
            type="checkbox"
            name="stopRecording"
            checked={recording ?? !settings.recordingEnabled}
            onChange={(event) => {
              if (recording === null && usage === null)
                setBaseRevision(settings.revision);
              setRecording(event.target.checked);
            }}
          />{" "}
          Stop recording
        </label>
        <p>
          Stops new automatic memories and cancels pending extraction. Existing
          memory is kept.
        </p>
        <label>
          <input
            type="checkbox"
            name="stopUsage"
            checked={usage ?? !settings.usageEnabled}
            onChange={(event) => {
              if (recording === null && usage === null)
                setBaseRevision(settings.revision);
              setUsage(event.target.checked);
            }}
          />{" "}
          Stop using in chat
        </label>
        <p>
          Stops memory and summary recall in future chat prompts. Recording is
          controlled separately. Replies already started may use their existing
          prompt.
        </p>
        <button type="submit">{pending ? "Saving…" : "Save controls"}</button>
      </fieldset>
      <MemoryFormStatus state={state} />
    </form>
  );
}
