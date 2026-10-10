"use client";

import { useActionState, useId } from "react";
import {
  resetGlobalMemorySettingsAction,
  retryMemoryOperationAction,
  updateGlobalMemorySettingsAction,
  type MemoryAdminActionState,
} from "./actions";
import type { MemoryRetryCandidate } from "@/server/admin/memory-operations-queries";
import type { GlobalMemorySettings } from "@/server/admin/memory-settings-service";

function Feedback({ state }: { state: MemoryAdminActionState }) {
  return state.message
    ? <p role={state.status === "error" ? "alert" : "status"}>{state.message}</p>
    : null;
}

export function GlobalMemorySettingsForm({ settings }: { settings: GlobalMemorySettings }) {
  const id = useId();
  const [state, action, pending] = useActionState(
    (previous: MemoryAdminActionState, formData: FormData) =>
      formData.get("intent") === "reset"
        ? resetGlobalMemorySettingsAction(previous, formData)
        : updateGlobalMemorySettingsAction(previous, formData),
    {
      status: "idle",
      values: { expectedRevision: String(settings.revision), enabled: String(settings.enabled) },
    } satisfies MemoryAdminActionState,
  );
  const values = state.values!;
  return (
    <section aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>Global memory processing</h2>
      <p>Disabling prevents new processing. Existing memories remain readable under each relationship&apos;s usage control.</p>
      <Feedback state={state} />
      <form action={action} key={`update-${values.expectedRevision}-${values.enabled}`}>
        <input type="hidden" name="intent" value="update" />
        <input type="hidden" name="expectedRevision" value={values.expectedRevision} />
        <label htmlFor={`${id}-enabled`}>New memory processing</label>
        <select id={`${id}-enabled`} name="enabled" defaultValue={values.enabled}>
          <option value="true">Enabled</option>
          <option value="false">Disabled</option>
        </select>
        {state.fieldErrors?.enabled?.map((error) => <p key={error}>{error}</p>)}
        <button type="submit" disabled={pending}>Save memory setting</button>
      </form>
      <form action={action} key={`reset-${values.expectedRevision}`}>
        <input type="hidden" name="intent" value="reset" />
        <input type="hidden" name="expectedRevision" value={values.expectedRevision} />
        <label><input name="confirm" type="checkbox" /> Restore the stored deployment default</label>
        <button type="submit" disabled={pending}>Reset memory setting</button>
      </form>
    </section>
  );
}

function RetryForm({ candidate }: { candidate: MemoryRetryCandidate }) {
  const [state, action, pending] = useActionState(retryMemoryOperationAction, { status: "idle" } satisfies MemoryAdminActionState);
  return (
    <form action={action}>
      <input type="hidden" name="operationType" value={candidate.operationType} />
      <input type="hidden" name="operationId" value={candidate.operationId} />
      <button type="submit" disabled={pending}>Retry {candidate.operationType.replaceAll("_", " ")} {candidate.operationId}</button>
      <Feedback state={state} />
    </form>
  );
}

export function MemoryRetryForms({ candidates }: { candidates: MemoryRetryCandidate[] }) {
  return (
    <section aria-labelledby="memory-retry-heading">
      <h2 id="memory-retry-heading">Retry terminal operations</h2>
      {candidates.length ? candidates.map((candidate) => (
        <RetryForm key={`${candidate.operationType}:${candidate.operationId}`} candidate={candidate} />
      )) : <p>No eligible operations to retry.</p>}
    </section>
  );
}
