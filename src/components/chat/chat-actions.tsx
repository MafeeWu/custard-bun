"use client";

import { DotsThree, Trash, X } from "@phosphor-icons/react";
import { useActionState, useEffect, useRef, useState } from "react";
import type { ConversationActionState } from "@/app/app/conversations/actions";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { IconButton } from "@/components/ui/icon-button";
import type { ConversationAction } from "./chat-screen";

const idleState: ConversationActionState = { status: "idle" };

export const deletionConfirmation =
  "Permanently delete this conversation. Existing long-term memory is retained. Unapplied extraction from this conversation is cancelled. The deleted transcript cannot later form memory.";

function ConfirmAction({
  action,
  confirmation,
  disabled = false,
  label,
  onPendingChange,
  tone = "primary",
}: {
  action: ConversationAction;
  confirmation: string;
  disabled?: boolean;
  label: string;
  onPendingChange?: (pending: boolean) => void;
  tone?: "primary" | "danger";
}) {
  const [state, formAction, pending] = useActionState(action, idleState);

  useEffect(() => {
    onPendingChange?.(pending);
  }, [onPendingChange, pending]);

  return (
    <form action={formAction} className="chat-confirm-action">
      <label>
        <input
          disabled={disabled || pending}
          name="confirm"
          required
          type="checkbox"
        />{" "}
        {confirmation}
      </label>
      <Button
        disabled={disabled || pending}
        pending={pending}
        tone={tone}
        type="submit"
      >
        {pending ? "Working…" : label}
      </Button>
      {state.message ? (
        <p role={state.status === "error" ? "alert" : "status"}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

export function ChatActions({
  active,
  deleteAction,
  generating,
  restartAction,
}: {
  active: boolean;
  deleteAction: ConversationAction;
  generating: boolean;
  restartAction: ConversationAction;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <Button
        aria-label="Open conversation actions"
        className="chat-header-action"
        onClick={() => setOpen(true)}
        size="sm"
        tone="secondary"
        type="button"
      >
        <DotsThree aria-hidden="true" size={18} weight="bold" />
        Actions
      </Button>
      <Dialog
        description={
          active
            ? "Restart or permanently delete this conversation."
            : "Permanently delete this archived conversation."
        }
        initialFocusRef={closeButtonRef}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && pending) {
            return;
          }
          setOpen(nextOpen);
        }}
        open={open}
        title="Conversation actions"
      >
        <div className="chat-actions">
          <IconButton
            className="chat-actions__close"
            disabled={pending}
            icon={<X size={18} weight="bold" />}
            label="Close conversation actions"
            onClick={() => {
              if (!pending) {
                setOpen(false);
              }
            }}
            ref={closeButtonRef}
            size="sm"
            tone="quiet"
          />
          {active ? (
            <div className="chat-actions__section">
              <h3>Start fresh</h3>
              <ConfirmAction
                action={restartAction}
                confirmation="Archive this conversation and start over."
                disabled={generating}
                label="Start over"
                onPendingChange={setPending}
              />
            </div>
          ) : null}
          <div
            aria-label="Danger zone"
            className="chat-actions__danger-zone"
            role="group"
          >
            <h3>
              <Trash aria-hidden="true" size={18} weight="bold" />
              Danger zone
            </h3>
            <ConfirmAction
              action={deleteAction}
              confirmation={deletionConfirmation}
              disabled={generating}
              label="Delete conversation"
              onPendingChange={setPending}
              tone="danger"
            />
          </div>
        </div>
      </Dialog>
    </>
  );
}
