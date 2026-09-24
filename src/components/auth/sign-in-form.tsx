"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
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
    <form aria-label="Sign in" onSubmit={handleSubmit}>
      <label htmlFor="sign-in-email">Email</label>
      <input
        id="sign-in-email"
        name="email"
        type="email"
        autoComplete="email"
        disabled={pending}
        required
      />

      <label htmlFor="sign-in-password">Password</label>
      <input
        id="sign-in-password"
        name="password"
        type="password"
        autoComplete="current-password"
        disabled={pending}
        required
      />

      <button disabled={pending} type="submit">
        {pending ? "Signing in..." : "Sign in"}
      </button>

      {errorMessage ? <p role="alert">{errorMessage}</p> : null}
    </form>
  );
}
