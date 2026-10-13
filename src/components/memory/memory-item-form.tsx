"use client";

import { Trash } from "@phosphor-icons/react";
import {
  useActionState,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { RelationshipMemoryScreenView } from "@/server/memory/memory-queries";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { CheckboxField, Field, Textarea } from "@/components/ui/field";
import {
  idleMemoryState,
  MemoryFormStatus,
  useMemoryRevision,
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
  const editRevision = useMemoryRevision(item.revision, state);
  const deleteRevision = useMemoryRevision(item.revision, deleteState);
  const [explicit, setExplicit] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [open, setOpen] = useState(false);
  const confirmRef = useRef<HTMLInputElement>(null);
  const [previousState, setPreviousState] = useState(state);
  const [previousDeleteState, setPreviousDeleteState] = useState(deleteState);
  if (previousState !== state) {
    setPreviousState(state);
    if (state.status === "success") {
      setDraft(null);
      setExplicit(false);
    }
  }
  if (previousDeleteState !== deleteState) {
    setPreviousDeleteState(deleteState);
    if (deleteState.status === "success") {
      setConfirmed(false);
      setOpen(false);
    }
  }
  const id = useId();
  const busy = pending || deleting;
  const content = draft ?? item.content;
  const deletingRef = useRef(deleting);
  const openRef = useRef(open);

  useEffect(() => {
    deletingRef.current = deleting;
  }, [deleting]);

  useEffect(() => {
    if (openRef.current && !open && !confirmed) {
      deleteRevision.reset();
    }
    openRef.current = open;
  }, [confirmed, deleteRevision, open]);

  const handleDeleteDialogChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen && deletingRef.current) {
      return;
    }

    setOpen(nextOpen);
    if (!nextOpen) {
      setConfirmed(false);
    }
  }, []);

  return (
    <article className="memory-card memory-item" aria-label="Memory">
      <div className="memory-item__header">
        <div className="memory-item__title-group">
          <p className="memory-item__eyebrow">Saved memory</p>
          <h3>{item.type.replaceAll("_", " ")}</h3>
        </div>
        <dl className="memory-item__meta">
          <div>
            <dt>Source</dt>
            <dd>
              {item.origin === "automatic" ? "Automatic" : "Edited by you"}
            </dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>Active</dd>
          </div>
          <div>
            <dt>Evidence</dt>
            <dd>{item.supportingSourceCount} supporting sources</dd>
          </div>
          <div>
            <dt>Last confirmed</dt>
            <dd>
              <time dateTime={item.lastConfirmedAt.toISOString()}>
                {item.lastConfirmedAt.toISOString().slice(0, 10)}
              </time>
            </dd>
          </div>
        </dl>
      </div>
      <p className="memory-content">{item.content}</p>
      <form
        action={action}
        className="memory-form"
        onSubmit={editRevision.beginSubmission}
      >
        <input name="memoryId" type="hidden" value={item.id} />
        <input
          name="expectedRevision"
          type="hidden"
          value={editRevision.revision}
        />
        <fieldset disabled={busy}>
          <Field
            hint="Credentials cannot be saved. Sensitive personal content needs explicit intent. Your edits are authoritative."
            htmlFor={id}
            label="Memory content"
          >
            <Textarea
              id={id}
              maxLength={1000}
              name="content"
              required
              value={content}
              onChange={(event) => {
                if (draft === null) editRevision.capture();
                setDraft(event.target.value);
              }}
            />
          </Field>
          <CheckboxField
            checked={explicit}
            label="I explicitly want to remember this content, including any sensitive personal details."
            name="explicitIntent"
            onChange={(event) => setExplicit(event.target.checked)}
          />
          <div className="memory-form__actions">
            <Button type="submit">{pending ? "Saving…" : "Save memory"}</Button>
            <Button
              onClick={() => handleDeleteDialogChange(true)}
              tone="danger"
              type="button"
            >
              <Trash aria-hidden="true" size={18} weight="bold" />
              Delete memory
            </Button>
          </div>
        </fieldset>
        <MemoryFormStatus state={state} />
      </form>

      <Dialog
        description="Permanently delete this memory."
        initialFocusRef={confirmRef}
        onOpenChange={handleDeleteDialogChange}
        open={open}
        title="Delete memory"
      >
        <form
          action={remove}
          aria-label="Delete memory"
          className="memory-danger__dialog"
          onSubmit={deleteRevision.beginSubmission}
        >
          <input name="memoryId" type="hidden" value={item.id} />
          <input
            name="expectedRevision"
            type="hidden"
            value={deleteRevision.revision}
          />
          <CheckboxField
            checked={confirmed}
            label="Permanently delete this memory."
            name="confirm"
            onChange={(event) => {
              if (event.target.checked) deleteRevision.capture();
              else deleteRevision.reset();
              setConfirmed(event.target.checked);
            }}
            ref={confirmRef}
            required
          />
          <div className="memory-dialog__actions">
            <Button
              disabled={deleting}
              onClick={() => handleDeleteDialogChange(false)}
              tone="quiet"
              type="button"
            >
              Cancel
            </Button>
            <Button
              disabled={deleting || !confirmed}
              tone="danger"
              type="submit"
            >
              {deleting ? "Deleting…" : "Delete memory"}
            </Button>
          </div>
          <MemoryFormStatus state={deleteState} />
        </form>
      </Dialog>
    </article>
  );
}
