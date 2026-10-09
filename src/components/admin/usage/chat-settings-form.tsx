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

async function submitGlobalChatSettings(
  state: UsageAdminActionState,
  formData: FormData,
) {
  return formData.get("intent") === "reset"
    ? resetGlobalChatSettingsAction(state, formData)
    : updateGlobalChatSettingsAction(state, formData);
}

export function ChatSettingsForm({
  settings,
}: {
  settings: GlobalChatSettings;
}) {
  const formId = useId();
  const initialValues = valuesFrom(settings);
  const [state, action, pending] = useActionState(submitGlobalChatSettings, {
    status: "idle",
    values: initialValues,
  } satisfies UsageAdminActionState);
  const values = state.values ?? initialValues;
  const revisionKey = values.expectedRevision;
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
      <Feedback state={state} />
      <form action={action} key={`update-${revisionKey}`}>
        <input type="hidden" name="intent" value="update" />
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
                state.fieldErrors?.[name]
                  ? `${formId}-${name}-error`
                  : undefined
              }
            />
            {state.fieldErrors?.[name]?.map((error) => (
              <p id={`${formId}-${name}-error`} key={error}>
                {error}
              </p>
            ))}
          </div>
        ))}
        <button type="submit" disabled={pending}>
          Save chat settings
        </button>
      </form>

      <form action={action} key={`reset-${revisionKey}`}>
        <input type="hidden" name="intent" value="reset" />
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
        <button type="submit" disabled={pending}>
          Reset to deployment defaults
        </button>
      </form>
    </section>
  );
}
