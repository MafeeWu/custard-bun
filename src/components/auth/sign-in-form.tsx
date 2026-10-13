"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { authClient } from "@/server/auth/auth-client";
import { signInErrorMessage } from "./error-message";

export function SignInForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setErrorMessage(undefined);

    const form = new FormData(event.currentTarget);

    try {
      const result = await authClient.signIn.email({
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
        rememberMe: true,
      });

      if (result.error) {
        setErrorMessage(signInErrorMessage(result.error));
        return;
      }

      router.push("/app");
    } catch {
      setErrorMessage("Unable to sign in. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form aria-label="Sign in" className="auth-form" onSubmit={handleSubmit}>
      <div className="auth-form__fields">
        <Field error={errorMessage} htmlFor="sign-in-email" label="Email">
          <Input
            autoComplete="email"
            disabled={pending}
            id="sign-in-email"
            name="email"
            required
            type="email"
          />
        </Field>

        <Field htmlFor="sign-in-password" label="Password">
          <Input
            autoComplete="current-password"
            disabled={pending}
            id="sign-in-password"
            name="password"
            required
            type="password"
          />
        </Field>
      </div>

      <Button className="auth-form__submit" pending={pending} type="submit">
        Sign in
      </Button>
    </form>
  );
}
