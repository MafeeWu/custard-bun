"use client";

import { WarningOctagon } from "@phosphor-icons/react";
import {
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { CheckboxField } from "@/components/ui/field";
import {
  idleMemoryState,
  MemoryFormStatus,
  useMemoryRevision,
  type MemoryAction,
} from "./memory-form-state";

const forgetCopy =
  "Removes memory, evidence, and relationship summary. Cancels old work and starts a new memory epoch. Your conversation transcripts are kept.";

export function ForgetCharacterForm({
  revision,
  action: forget,
}: {
  revision: number;
  action: MemoryAction;
}) {
  const [state, action, pending] = useActionState(forget, idleMemoryState);
  const [confirmed, setConfirmed] = useState(false);
  const [open, setOpen] = useState(false);
  const baseRevision = useMemoryRevision(revision, state);
  const confirmRef = useRef<HTMLInputElement>(null);
  const pendingRef = useRef(pending);
  const openRef = useRef(open);
  const [previousState, setPreviousState] = useState(state);
  if (previousState !== state) {
    setPreviousState(state);
    if (state.status === "success") {
      setConfirmed(false);
      setOpen(false);
    }
  }

  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  useEffect(() => {
    if (openRef.current && !open && !confirmed) {
      baseRevision.reset();
    }
    openRef.current = open;
  }, [baseRevision, confirmed, open]);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen && pendingRef.current) {
      return;
    }

    setOpen(nextOpen);

    if (!nextOpen) {
      setConfirmed(false);
    }
  }, []);

  return (
    <section
      aria-label="Forget character"
      className="memory-card memory-danger"
      role="region"
    >
      <div className="memory-section-heading">
        <div>
          <h2>Forget character</h2>
          <p>{forgetCopy}</p>
        </div>
      </div>
      <div className="memory-danger__summary">
        <p>This is the strongest privacy reset for this relationship.</p>
        <Button
          onClick={() => handleOpenChange(true)}
          tone="danger"
          type="button"
        >
          <WarningOctagon aria-hidden="true" size={18} weight="bold" />
          Forget character
        </Button>
      </div>

      <Dialog
        description={forgetCopy}
        initialFocusRef={confirmRef}
        onOpenChange={handleOpenChange}
        open={open}
        title="Forget character"
      >
        <form
          action={action}
          aria-label="Forget character"
          className="memory-danger__dialog"
          onSubmit={baseRevision.beginSubmission}
        >
          <input
            name="expectedRevision"
            type="hidden"
            value={baseRevision.revision}
          />
          <CheckboxField
            checked={confirmed}
            label="I want this character to forget me."
            name="confirm"
            onChange={(event) => {
              if (event.target.checked) baseRevision.capture();
              else baseRevision.reset();
              setConfirmed(event.target.checked);
            }}
            ref={confirmRef}
            required
          />
          <div className="memory-dialog__actions">
            <Button
              disabled={pending}
              onClick={() => handleOpenChange(false)}
              tone="quiet"
              type="button"
            >
              Cancel
            </Button>
            <Button
              disabled={pending || !confirmed}
              tone="danger"
              type="submit"
            >
              {pending ? "Forgetting…" : "Forget character"}
            </Button>
          </div>
          <MemoryFormStatus state={state} />
        </form>
      </Dialog>
    </section>
  );
}
