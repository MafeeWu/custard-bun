"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { StatusNotice } from "@/components/ui/status-notice";
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
    <form
      aria-label="Forgot password"
      className="auth-form"
      onSubmit={handleSubmit}
    >
      <div className="auth-form__fields">
        <Field
          error={errorMessage}
          htmlFor="forgot-password-email"
          label="Email"
        >
          <Input
            autoComplete="email"
            disabled={pending}
            id="forgot-password-email"
            name="email"
            required
            type="email"
          />
        </Field>
      </div>

      <Button className="auth-form__submit" pending={pending} type="submit">
        Send reset link
      </Button>

      {statusMessage ? (
        <StatusNotice className="auth-form__notice" tone="success">
          {statusMessage}
        </StatusNotice>
      ) : null}
    </form>
  );
}
