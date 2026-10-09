"use client";

import { useActionState, useId } from "react";
import {
  resetGlobalChatSettingsAction,
  updateGlobalChatSettingsAction,
  type GlobalSettingsFormValues,
  type UsageAdminActionState,
} from "@/app/admin/usage/actions";
import type { GlobalChatSettings } from "@/server/admin/chat-settings-service";

function valuesFrom(settings: GlobalChatSettings): GlobalSettingsFormValues {
  return {
    expectedRevision: String(settings.revision),
    userDailyRequestLimit: String(settings.userDailyRequestLimit),
    userDailyTokenLimit: String(settings.userDailyTokenLimit),
    instanceMonthlyRequestLimit: String(settings.instanceMonthlyRequestLimit),
    instanceMonthlyTokenBudget: String(settings.instanceMonthlyTokenBudget),
    maxConcurrentGenerations: String(settings.maxConcurrentGenerations),
  };
}

function Feedback({ state }: { state: UsageAdminActionState }) {
  if (!state.message) return null;
  return (
    <p role={state.status === "error" ? "alert" : "status"}>{state.message}</p>
  );
}

export function ChatSettingsForm({
  settings,
}: {
  settings: GlobalChatSettings;
}) {
  const formId = useId();
  const initialValues = valuesFrom(settings);
  const [updateState, updateAction, updatePending] = useActionState(
    updateGlobalChatSettingsAction,
    { status: "idle", values: initialValues } satisfies UsageAdminActionState,
  );
  const [resetState, resetAction, resetPending] = useActionState(
    resetGlobalChatSettingsAction,
    { status: "idle" } satisfies UsageAdminActionState,
  );
  const values = updateState.values ?? initialValues;
  const fields = [
    ["userDailyRequestLimit", "User daily request limit"],
    ["userDailyTokenLimit", "User daily token limit"],
    ["instanceMonthlyRequestLimit", "Instance monthly request limit"],
    ["instanceMonthlyTokenBudget", "Instance monthly token budget"],
    ["maxConcurrentGenerations", "Maximum concurrent generations"],
  ] as const;

  return (
    <section aria-labelledby={`${formId}-heading`}>
      <h2 id={`${formId}-heading`}>Global chat settings</h2>
      <p>Changes apply to new generation admissions only.</p>
      <form action={updateAction}>
        <Feedback state={updateState} />
        <input
          type="hidden"
          name="expectedRevision"
          value={values.expectedRevision}
        />
        {fields.map(([name, label]) => (
          <div key={name}>
            <label htmlFor={`${formId}-${name}`}>{label}</label>
            <input
              id={`${formId}-${name}`}
              name={name}
              type="number"
              min={1}
              step={1}
              defaultValue={values[name]}
              aria-describedby={
                updateState.fieldErrors?.[name]
                  ? `${formId}-${name}-error`
                  : undefined
              }
            />
            {updateState.fieldErrors?.[name]?.map((error) => (
              <p id={`${formId}-${name}-error`} key={error}>
                {error}
              </p>
            ))}
          </div>
        ))}
        <button type="submit" disabled={updatePending}>
          Save chat settings
        </button>
      </form>

      <form action={resetAction}>
        <Feedback state={resetState} />
        <input
          type="hidden"
          name="expectedRevision"
          value={values.expectedRevision}
        />
        <label htmlFor={`${formId}-reset-confirm`}>
          <input
            id={`${formId}-reset-confirm`}
            type="checkbox"
            name="confirm"
          />
          Restore the stored deployment defaults.
        </label>
        <button type="submit" disabled={resetPending}>
          Reset to deployment defaults
        </button>
      </form>
    </section>
  );
}
