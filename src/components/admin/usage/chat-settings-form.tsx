"use client";

import { useActionState, useId } from "react";
import { AdminSection } from "@/components/admin/admin-section";
import { Button } from "@/components/ui/button";
import {
  CheckboxField,
  Field,
  fieldErrorMessages,
  Input,
} from "@/components/ui/field";
import { StatusNotice } from "@/components/ui/status-notice";
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
    <StatusNotice tone={state.status === "error" ? "danger" : "success"}>
      {state.message}
    </StatusNotice>
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
    <AdminSection
      title="Global chat settings"
      description="Changes apply to new generation admissions only."
    >
      <Feedback state={state} />
      <form
        action={action}
        className="admin-settings-form"
        key={`update-${revisionKey}`}
      >
        <input type="hidden" name="intent" value="update" />
        <input
          type="hidden"
          name="expectedRevision"
          value={values.expectedRevision}
        />
        {fields.map(([name, label]) => (
          <Field
            error={fieldErrorMessages(state.fieldErrors?.[name])}
            htmlFor={`${formId}-${name}`}
            key={name}
            label={label}
          >
            <Input
              id={`${formId}-${name}`}
              name={name}
              type="number"
              min={1}
              step={1}
              defaultValue={values[name]}
            />
          </Field>
        ))}
        <Button type="submit" pending={pending}>
          Save chat settings
        </Button>
      </form>

      <form
        action={action}
        className="admin-settings-form"
        key={`reset-${revisionKey}`}
      >
        <input type="hidden" name="intent" value="reset" />
        <input
          type="hidden"
          name="expectedRevision"
          value={values.expectedRevision}
        />
        <CheckboxField
          id={`${formId}-reset-confirm`}
          name="confirm"
          label="Restore the stored deployment defaults."
        />
        <Button type="submit" pending={pending} tone="secondary">
          Reset to deployment defaults
        </Button>
      </form>
    </AdminSection>
  );
}
