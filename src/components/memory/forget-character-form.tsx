"use client";

import { useActionState, useState } from "react";
import {
  idleMemoryState,
  MemoryFormStatus,
  useMemoryRevision,
  type MemoryAction,
} from "./memory-form-state";

export function ForgetCharacterForm({
  revision,
  action: forget,
}: {
  revision: number;
  action: MemoryAction;
}) {
  const [state, action, pending] = useActionState(forget, idleMemoryState);
  const [confirmed, setConfirmed] = useState(false);
  const baseRevision = useMemoryRevision(revision, state);
  const [previousState, setPreviousState] = useState(state);
  if (previousState !== state) {
    setPreviousState(state);
    if (state.status === "success") setConfirmed(false);
  }
  return (
    <section
      aria-label="Forget character"
      className="memory-card memory-danger"
    >
      <h2>Forget character</h2>
      <p>
        Removes memory, evidence, and relationship summary. Cancels old work and
        starts a new memory epoch. Your conversation transcripts are kept.
      </p>
      <form action={action} onSubmit={baseRevision.beginSubmission}>
        <input
          name="expectedRevision"
          type="hidden"
          value={baseRevision.revision}
        />
        <label>
          <input
            type="checkbox"
            name="confirm"
            required
            checked={confirmed}
            disabled={pending}
            onChange={(event) => {
              if (event.target.checked) baseRevision.capture();
              else baseRevision.reset();
              setConfirmed(event.target.checked);
            }}
          />{" "}
          I want this character to forget me.
        </label>
        <button type="submit" disabled={pending || !confirmed}>
          {pending ? "Forgetting…" : "Forget character"}
        </button>
        <MemoryFormStatus state={state} />
      </form>
    </section>
  );
}
