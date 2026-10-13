"use client";

import { useRef, useState, type FormEvent } from "react";
import { requestAccountDeletionAction } from "@/app/account/delete/actions";
import { AccountSection } from "@/components/account/account-section";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { StatusNotice } from "@/components/ui/status-notice";

interface DeleteAccountFormProps {
  email: string;
}

const deletionConsequenceCopy =
  "Deletion confirmation immediately signs you out and stops account access. Private data is then purged asynchronously. This cannot be undone.";

export function DeleteAccountForm({ email }: DeleteAccountFormProps) {
  const [confirmation, setConfirmation] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>();
  const [errorMessage, setErrorMessage] = useState<string>();
  const confirmationRef = useRef<HTMLInputElement>(null);

  const matches = confirmation === email;

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && pending) {
      return;
    }

    setOpen(nextOpen);

    if (!nextOpen) {
      setConfirmation("");
      setStatusMessage(undefined);
      setErrorMessage(undefined);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!matches) {
      return;
    }

    setPending(true);
    setStatusMessage(undefined);
    setErrorMessage(undefined);

    try {
      const result = await requestAccountDeletionAction(
        { status: "idle" },
        new FormData(),
      );

      if (result.status === "error") {
        setErrorMessage(
          result.code === "rate_limited"
            ? "Too many attempts. Please try again later."
            : "Unable to request account deletion. Try again.",
        );
        return;
      }

      setStatusMessage("A confirmation link has been sent to your email.");
    } catch {
      setErrorMessage("Unable to request account deletion. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <AccountSection
        description={deletionConsequenceCopy}
        headingId="delete-account-heading"
        title="Delete account"
        tone="danger"
      >
        <div className="account-delete">
          <p className="account-delete__email">
            Account email <strong>{email}</strong>
          </p>
          <p className="account-delete__hint">
            We email the confirmation link first. Type your exact account email
            before you request it.
          </p>
          <Button
            onClick={() => handleOpenChange(true)}
            tone="danger"
            type="button"
          >
            Delete account
          </Button>
        </div>
      </AccountSection>

      <Dialog
        description={deletionConsequenceCopy}
        initialFocusRef={confirmationRef}
        onOpenChange={handleOpenChange}
        open={open}
        title="Delete account"
      >
        <form
          aria-label="Delete account"
          className="account-delete__dialog"
          onSubmit={handleSubmit}
        >
          <div className="ui-field">
            <label className="ui-field__label" htmlFor="confirm-account-email">
              Confirm account email
            </label>
            <p className="ui-field__hint">
              We email the confirmation link first. Type your exact account
              email before you request it.
            </p>
            <input
              ref={confirmationRef}
              className="ui-field__control"
              id="confirm-account-email"
              type="email"
              autoComplete="off"
              disabled={pending}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </div>

          {statusMessage ? (
            <StatusNotice tone="success">{statusMessage}</StatusNotice>
          ) : null}
          {errorMessage ? (
            <StatusNotice tone="danger">{errorMessage}</StatusNotice>
          ) : null}

          <div className="account-delete__dialog-actions">
            <Button
              disabled={pending}
              onClick={() => handleOpenChange(false)}
              tone="quiet"
              type="button"
            >
              Cancel
            </Button>
            <Button
              disabled={!matches}
              pending={pending}
              tone="danger"
              type="submit"
            >
              Delete account
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
