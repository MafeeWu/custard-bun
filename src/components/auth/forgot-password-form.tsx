"use client";

import { useState, type FormEvent } from "react";
import { authClient } from "@/server/auth/auth-client";
import { authErrorMessage } from "./error-message";

const resetLinkSentMessage =
  "If an account exists for that email, a reset link has been sent.";

export function ForgotPasswordForm() {
  const [pending, setPending] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>();
  const [errorMessage, setErrorMessage] = useState<string>();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setStatusMessage(undefined);
    setErrorMessage(undefined);

    const form = new FormData(event.currentTarget);

    try {
      const result = await authClient.requestPasswordReset({
        email: String(form.get("email") ?? ""),
        redirectTo: "/auth/reset-password",
      });

      if (result.error) {
        setErrorMessage(
          authErrorMessage(
            result.error,
            "Unable to send a reset link. Please try again.",
          ),
        );
        return;
      }

      setStatusMessage(resetLinkSentMessage);
    } catch {
      setErrorMessage("Unable to send a reset link. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form aria-label="Forgot password" onSubmit={handleSubmit}>
      <label htmlFor="forgot-password-email">Email</label>
      <input
        id="forgot-password-email"
        name="email"
        type="email"
        autoComplete="email"
        disabled={pending}
        required
      />

      <button disabled={pending} type="submit">
        {pending ? "Sending reset link..." : "Send reset link"}
      </button>

      {statusMessage ? <p role="status">{statusMessage}</p> : null}
      {errorMessage ? <p role="alert">{errorMessage}</p> : null}
    </form>
  );
}
