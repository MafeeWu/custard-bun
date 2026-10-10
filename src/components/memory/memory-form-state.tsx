"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { MemoryActionState } from "@/app/app/memories/actions";

export type MemoryAction = (
  state: MemoryActionState,
  data: FormData,
) => Promise<MemoryActionState>;
export const idleMemoryState: MemoryActionState = { status: "idle" };

export function MemoryFormStatus({ state }: { state: MemoryActionState }) {
  const router = useRouter();
  const statusRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (state.status === "conflict" || state.status === "success")
      router.refresh();
    if (state.status === "conflict" || state.status === "error")
      statusRef.current?.focus();
  }, [state, router]);
  return (
    <p
      ref={statusRef}
      tabIndex={-1}
      role={
        state.status === "error" || state.status === "conflict"
          ? "alert"
          : "status"
      }
      aria-live="polite"
    >
      {state.message}
    </p>
  );
}
