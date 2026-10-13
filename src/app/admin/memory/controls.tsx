"use client";

import { useActionState, useId } from "react";
import { AdminSection } from "@/components/admin/admin-section";
import { Button } from "@/components/ui/button";
import {
  CheckboxField,
  Field,
  fieldErrorMessages,
} from "@/components/ui/field";
import { StatusNotice } from "@/components/ui/status-notice";
import {
  resetGlobalMemorySettingsAction,
  retryMemoryOperationAction,
  updateGlobalMemorySettingsAction,
  type MemoryAdminActionState,
} from "./actions";
import type { MemoryRetryCandidate } from "@/server/admin/memory-operations-queries";
import type { GlobalMemorySettings } from "@/server/admin/memory-settings-service";

function Feedback({ state }: { state: MemoryAdminActionState }) {
  return state.message ? (
    <StatusNotice tone={state.status === "error" ? "danger" : "success"}>
      {state.message}
    </StatusNotice>
  ) : null;
}

export function GlobalMemorySettingsForm({
  settings,
}: {
  settings: GlobalMemorySettings;
}) {
  const id = useId();
  const [state, action, pending] = useActionState(
    (previous: MemoryAdminActionState, formData: FormData) =>
      formData.get("intent") === "reset"
        ? resetGlobalMemorySettingsAction(previous, formData)
        : updateGlobalMemorySettingsAction(previous, formData),
    {
      status: "idle",
      values: {
        expectedRevision: String(settings.revision),
        enabled: String(settings.enabled),
      },
    } satisfies MemoryAdminActionState,
  );
  const values = state.values!;
  return (
    <AdminSection
      title="Global memory processing"
      description="Disabling prevents new processing. Existing memories remain readable under each relationship's usage control."
    >
      <Feedback state={state} />
      <form
        action={action}
        className="admin-settings-form"
        key={`update-${values.expectedRevision}-${values.enabled}`}
      >
        <input type="hidden" name="intent" value="update" />
        <input
          type="hidden"
          name="expectedRevision"
          value={values.expectedRevision}
        />
        <Field
          error={fieldErrorMessages(state.fieldErrors?.enabled)}
          htmlFor={`${id}-enabled`}
          label="New memory processing"
        >
          <select
            id={`${id}-enabled`}
            name="enabled"
            defaultValue={values.enabled}
          >
            <option value="true">Enabled</option>
            <option value="false">Disabled</option>
          </select>
        </Field>
        <Button type="submit" pending={pending}>
          Save memory setting
        </Button>
      </form>
      <form
        action={action}
        className="admin-settings-form"
        key={`reset-${values.expectedRevision}`}
      >
        <input type="hidden" name="intent" value="reset" />
        <input
          type="hidden"
          name="expectedRevision"
          value={values.expectedRevision}
        />
        <CheckboxField
          name="confirm"
          label="Restore the stored deployment default"
        />
        <Button type="submit" pending={pending} tone="secondary">
          Reset memory setting
        </Button>
      </form>
    </AdminSection>
  );
}

function RetryForm({ candidate }: { candidate: MemoryRetryCandidate }) {
  const [state, action, pending] = useActionState(retryMemoryOperationAction, {
    status: "idle",
  } satisfies MemoryAdminActionState);
  return (
    <form action={action} className="admin-inline-form">
      <input
        type="hidden"
        name="operationType"
        value={candidate.operationType}
      />
      <input type="hidden" name="operationId" value={candidate.operationId} />
      <Button type="submit" pending={pending} size="sm" tone="secondary">
        Retry {candidate.operationType.replaceAll("_", " ")}{" "}
        {candidate.operationId}
      </Button>
      <Feedback state={state} />
    </form>
  );
}

export function MemoryRetryForms({
  candidates,
}: {
  candidates: MemoryRetryCandidate[];
}) {
  return (
    <AdminSection title="Retry terminal operations">
      {candidates.length ? (
        candidates.map((candidate) => (
          <RetryForm
            key={`${candidate.operationType}:${candidate.operationId}`}
            candidate={candidate}
          />
        ))
      ) : (
        <p>No eligible operations to retry.</p>
      )}
    </AdminSection>
  );
}
