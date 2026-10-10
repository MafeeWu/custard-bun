"use client";

import { useActionState, useId, useState } from "react";
import type { RelationshipMemoryScreenView } from "@/server/memory/memory-queries";
import {
  idleMemoryState,
  MemoryFormStatus,
  type MemoryAction,
} from "./memory-form-state";

export function MemoryItemForm({
  item,
  editAction,
  deleteAction,
}: {
  item: RelationshipMemoryScreenView["items"][number];
  editAction: MemoryAction;
  deleteAction: MemoryAction;
}) {
  const [state, action, pending] = useActionState(editAction, idleMemoryState);
  const [deleteState, remove, deleting] = useActionState(
    deleteAction,
    idleMemoryState,
  );
  const [draft, setDraft] = useState<string | null>(null);
  const [baseRevision, setBaseRevision] = useState(item.revision);
  const [deleteRevision, setDeleteRevision] = useState(item.revision);
  const [explicit, setExplicit] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [previousState, setPreviousState] = useState(state);
  if (previousState !== state) {
    setPreviousState(state);
    if (state.status === "success") {
      setDraft(null);
      setExplicit(false);
    }
  }
  const id = useId();
  const busy = pending || deleting;
  const content = draft ?? item.content;
  return (
    <article className="memory-card" aria-label="Memory">
      <h3>{item.type.replaceAll("_", " ")}</h3>
      <p className="memory-content">{item.content}</p>
      <p>
        {item.origin === "automatic"
          ? "Automatic · Active"
          : "Edited by you · Active"}
      </p>
      <p>
        {item.supportingSourceCount} supporting sources · Last confirmed{" "}
        <time dateTime={item.lastConfirmedAt.toISOString()}>
          {item.lastConfirmedAt.toISOString().slice(0, 10)}
        </time>
      </p>
      <form action={action}>
        <input name="memoryId" type="hidden" value={item.id} />
        <input
          name="expectedRevision"
          type="hidden"
          value={
            draft !== null && state.status !== "conflict"
              ? baseRevision
              : item.revision
          }
        />
        <fieldset disabled={busy}>
          <label htmlFor={id}>Memory content</label>
          <textarea
            id={id}
            name="content"
            maxLength={1000}
            required
            value={content}
            onChange={(event) => {
              if (draft === null) setBaseRevision(item.revision);
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
            I explicitly want to remember this content, including any sensitive
            personal details.
          </label>
          <p>
            Credentials cannot be saved. Sensitive personal content needs
            explicit intent. Your edits are authoritative.
          </p>
          <button type="submit">{pending ? "Saving…" : "Save memory"}</button>
        </fieldset>
        <MemoryFormStatus state={state} />
      </form>
      <form action={remove}>
        <input name="memoryId" type="hidden" value={item.id} />
        <input
          name="expectedRevision"
          type="hidden"
          value={
            confirmed && deleteState.status !== "conflict"
              ? deleteRevision
              : item.revision
          }
        />
        <label>
          <input
            type="checkbox"
            name="confirm"
            required
            disabled={busy}
            checked={confirmed}
            onChange={(event) => {
              if (event.target.checked) setDeleteRevision(item.revision);
              setConfirmed(event.target.checked);
            }}
          />{" "}
          Permanently delete this memory.
        </label>
        <button type="submit" disabled={busy || !confirmed}>
          {deleting ? "Deleting…" : "Delete memory"}
        </button>
        <MemoryFormStatus state={deleteState} />
      </form>
    </article>
  );
}
