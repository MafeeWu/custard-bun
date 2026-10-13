"use client";

import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { StatusNotice } from "@/components/ui/status-notice";
import { authClient } from "@/server/auth/auth-client";
import { authErrorMessage } from "./error-message";

export function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const [pending, setPending] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>();
  const [errorMessage, setErrorMessage] = useState<string>();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setStatusMessage(undefined);
    setErrorMessage(undefined);

    const token = searchParams.get("token");

    if (!token) {
      setPending(false);
      setErrorMessage("This reset link is invalid or has expired.");
      return;
    }

    const form = new FormData(event.currentTarget);

    try {
      const result = await authClient.resetPassword({
        token,
        newPassword: String(form.get("password") ?? ""),
      });

      if (result.error) {
        setErrorMessage(
          authErrorMessage(
            result.error,
            "This reset link is invalid or has expired.",
          ),
        );
        return;
      }

      setStatusMessage("Your password has been reset. You can sign in now.");
    } catch {
      setErrorMessage("Unable to reset your password. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      aria-label="Reset password"
      className="auth-form"
      onSubmit={handleSubmit}
    >
      <div className="auth-form__fields">
        <Field
          error={errorMessage}
          htmlFor="reset-password"
          label="New password"
        >
          <Input
            autoComplete="new-password"
            disabled={pending}
            id="reset-password"
            maxLength={128}
            minLength={12}
            name="password"
            required
            type="password"
          />
        </Field>
      </div>

      <Button className="auth-form__submit" pending={pending} type="submit">
        Reset password
      </Button>

      {statusMessage ? (
        <StatusNotice className="auth-form__notice" tone="success">
          {statusMessage}
        </StatusNotice>
      ) : null}
    </form>
  );
}
