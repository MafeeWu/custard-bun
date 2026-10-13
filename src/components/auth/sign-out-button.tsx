"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { StatusNotice } from "@/components/ui/status-notice";
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
    <div className="sign-out-button auth-form auth-form--compact">
      <Button
        className="auth-form__submit sign-out-button__submit"
        onClick={handleClick}
        pending={pending}
        tone="secondary"
        type="button"
      >
        Sign out
      </Button>
      {errorMessage ? (
        <StatusNotice
          className="auth-form__notice sign-out-button__notice"
          tone="danger"
        >
          {errorMessage}
        </StatusNotice>
      ) : null}
    </div>
  );
}
