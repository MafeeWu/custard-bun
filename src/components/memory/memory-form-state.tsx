"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { MemoryActionState } from "@/app/app/memories/actions";

export type MemoryAction = (
  state: MemoryActionState,
  data: FormData,
) => Promise<MemoryActionState>;
export const idleMemoryState: MemoryActionState = { status: "idle" };

export function useMemoryRevision<T>(
  current: T,
  state: MemoryActionState,
  equal: (left: T, right: T) => boolean = Object.is,
) {
  const [fence, setFence] = useState({
    version: current,
    captured: false,
    actionState: state,
    awaitingRefresh: false,
  });
  let next = fence;
  if (fence.actionState !== state) {
    next = {
      ...next,
      actionState: state,
      captured: state.status === "success" ? false : next.captured,
      awaitingRefresh: state.status === "conflict",
    };
  }
  // A conflict authorizes one refreshed version, not every later refresh.
  if (next.awaitingRefresh && !equal(next.version, current)) {
    next = {
      ...next,
      version: current,
      captured: true,
      awaitingRefresh: false,
    };
  }
  if (next !== fence) setFence(next);
  return {
    revision: next.captured ? next.version : current,
    capture() {
      setFence((previous) => ({
        ...previous,
        version: current,
        captured: true,
        awaitingRefresh: false,
      }));
    },
    beginSubmission() {
      setFence((previous) =>
        previous.captured
          ? previous
          : { ...previous, version: current, captured: true },
      );
    },
    reset() {
      setFence((previous) => ({
        ...previous,
        version: current,
        captured: false,
        awaitingRefresh: false,
      }));
    },
  };
}

export function MemoryFormStatus({ state }: { state: MemoryActionState }) {
  const router = useRouter();
  const statusRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (state.status === "conflict" || state.status === "success")
      router.refresh();
    if (state.status === "conflict" || state.status === "error")
      statusRef.current?.focus();
  }, [state, router]);
  if (state.status === "idle" || !state.message) return null;
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
