"use client";

import { useActionState, useState } from "react";
import {
  idleMemoryState,
  MemoryFormStatus,
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
  const [baseRevision, setBaseRevision] = useState(revision);
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
      <form action={action}>
        <input
          name="expectedRevision"
          type="hidden"
          value={
            confirmed && state.status !== "conflict" ? baseRevision : revision
          }
        />
        <label>
          <input
            type="checkbox"
            name="confirm"
            required
            checked={confirmed}
            disabled={pending}
            onChange={(event) => {
              if (event.target.checked) setBaseRevision(revision);
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
