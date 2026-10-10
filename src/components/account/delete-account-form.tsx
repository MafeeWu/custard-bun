"use client";

import { useState, type FormEvent } from "react";
import { requestAccountDeletionAction } from "@/app/account/delete/actions";

interface DeleteAccountFormProps {
  email: string;
}

export function DeleteAccountForm({ email }: DeleteAccountFormProps) {
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>();
  const [errorMessage, setErrorMessage] = useState<string>();

  const matches = confirmation === email;

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
    <form aria-label="Delete account" onSubmit={handleSubmit}>
      <label htmlFor="confirm-account-email">Confirm account email</label>
      <input
        id="confirm-account-email"
        type="email"
        autoComplete="off"
        disabled={pending}
        value={confirmation}
        onChange={(event) => setConfirmation(event.target.value)}
      />

      <button disabled={pending || !matches} type="submit">
        {pending ? "Requesting deletion..." : "Delete account"}
      </button>

      {statusMessage ? <p role="status">{statusMessage}</p> : null}
      {errorMessage ? <p role="alert">{errorMessage}</p> : null}
    </form>
  );
}
