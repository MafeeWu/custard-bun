"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/server/auth/auth-client";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();

  async function handleClick() {
    setPending(true);
    setErrorMessage(undefined);

    try {
      const result = await authClient.signOut();

      if (result.error) {
        setErrorMessage("Unable to sign out. Please try again.");
        return;
      }

      router.push("/auth/sign-in");
    } catch {
      setErrorMessage("Unable to sign out. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <button disabled={pending} type="button" onClick={handleClick}>
        {pending ? "Signing out..." : "Sign out"}
      </button>
      {errorMessage ? <p role="alert">{errorMessage}</p> : null}
    </div>
  );
}
