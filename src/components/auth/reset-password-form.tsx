"use client";

import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authClient } from "@/server/auth/auth-client";

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
        setErrorMessage("This reset link is invalid or has expired.");
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
    <form aria-label="Reset password" onSubmit={handleSubmit}>
      <label htmlFor="reset-password">New password</label>
      <input
        id="reset-password"
        name="password"
        type="password"
        autoComplete="new-password"
        disabled={pending}
        minLength={12}
        maxLength={128}
        required
      />

      <button disabled={pending} type="submit">
        {pending ? "Resetting password..." : "Reset password"}
      </button>

      {statusMessage ? <p role="status">{statusMessage}</p> : null}
      {errorMessage ? <p role="alert">{errorMessage}</p> : null}
    </form>
  );
}
