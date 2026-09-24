"use client";

import { useState, type FormEvent } from "react";
import { authClient } from "@/server/auth/auth-client";
import { authErrorMessage } from "./error-message";

interface SignUpFormProps {
  registrationOpen: boolean;
}

export function SignUpForm({ registrationOpen }: SignUpFormProps) {
  const [pending, setPending] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>();
  const [errorMessage, setErrorMessage] = useState<string>();

  if (!registrationOpen) {
    return <p>Registration is currently closed.</p>;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setStatusMessage(undefined);
    setErrorMessage(undefined);

    const form = new FormData(event.currentTarget);

    try {
      const result = await authClient.signUp.email({
        name: String(form.get("name") ?? ""),
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
        callbackURL: "/auth/verify-email",
      });

      if (result.error) {
        setErrorMessage(
          authErrorMessage(
            result.error,
            "Unable to create the account. Check your details and try again.",
          ),
        );
        return;
      }

      setStatusMessage("Check your email to verify your account.");
    } catch {
      setErrorMessage(
        "Unable to create the account. Check your details and try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form aria-label="Create account" onSubmit={handleSubmit}>
      <label htmlFor="sign-up-name">Name</label>
      <input
        id="sign-up-name"
        name="name"
        autoComplete="name"
        disabled={pending}
        required
      />

      <label htmlFor="sign-up-email">Email</label>
      <input
        id="sign-up-email"
        name="email"
        type="email"
        autoComplete="email"
        disabled={pending}
        required
      />

      <label htmlFor="sign-up-password">Password</label>
      <input
        id="sign-up-password"
        name="password"
        type="password"
        autoComplete="new-password"
        disabled={pending}
        minLength={12}
        maxLength={128}
        required
      />

      <button disabled={pending} type="submit">
        {pending ? "Creating account..." : "Create account"}
      </button>

      {statusMessage ? <p role="status">{statusMessage}</p> : null}
      {errorMessage ? <p role="alert">{errorMessage}</p> : null}
    </form>
  );
}
