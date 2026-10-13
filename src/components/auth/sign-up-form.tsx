"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { StatusNotice } from "@/components/ui/status-notice";
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
    return (
      <StatusNotice className="auth-form__notice" tone="warning">
        Registration is currently closed.
      </StatusNotice>
    );
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
    <form
      aria-label="Create account"
      className="auth-form"
      onSubmit={handleSubmit}
    >
      <div className="auth-form__fields">
        <Field htmlFor="sign-up-name" label="Name">
          <Input
            autoComplete="name"
            disabled={pending}
            id="sign-up-name"
            name="name"
            required
          />
        </Field>

        <Field error={errorMessage} htmlFor="sign-up-email" label="Email">
          <Input
            autoComplete="email"
            disabled={pending}
            id="sign-up-email"
            name="email"
            required
            type="email"
          />
        </Field>

        <Field htmlFor="sign-up-password" label="Password">
          <Input
            autoComplete="new-password"
            disabled={pending}
            id="sign-up-password"
            maxLength={128}
            minLength={12}
            name="password"
            required
            type="password"
          />
        </Field>
      </div>

      <Button className="auth-form__submit" pending={pending} type="submit">
        Create account
      </Button>

      {statusMessage ? (
        <StatusNotice className="auth-form__notice" tone="success">
          {statusMessage}
        </StatusNotice>
      ) : null}
    </form>
  );
}
