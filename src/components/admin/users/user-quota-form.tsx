"use client";

import { useActionState, useId } from "react";
import type { UserAdminActionState } from "@/app/admin/users/actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { StatusNotice } from "@/components/ui/status-notice";

type UserQuotaAction = (
  state: UserAdminActionState,
  formData: FormData,
) => Promise<UserAdminActionState>;

export function UserQuotaForm({
  user,
  action,
}: {
  user: {
    id: string;
    name: string;
    dailyRequestLimit: number | null;
    dailyTokenLimit: number | null;
  };
  action: UserQuotaAction;
}) {
  const formId = useId();
  const [state, formAction, pending] = useActionState(action, {
    status: "idle",
    values: {
      dailyRequestLimit: user.dailyRequestLimit?.toString() ?? "",
      dailyTokenLimit: user.dailyTokenLimit?.toString() ?? "",
    },
  } satisfies UserAdminActionState);
  const values = state.values ?? {
    dailyRequestLimit: user.dailyRequestLimit?.toString() ?? "",
    dailyTokenLimit: user.dailyTokenLimit?.toString() ?? "",
  };

  return (
    <form
      action={formAction}
      aria-label={`Quota override for ${user.name}`}
      className="admin-inline-form"
    >
      {state.message ? (
        <StatusNotice tone={state.status === "error" ? "danger" : "success"}>
          {state.message}
        </StatusNotice>
      ) : null}
      <Field
        error={state.fieldErrors?.dailyRequestLimit?.[0]}
        htmlFor={`${formId}-requests`}
        label="Daily request override"
      >
        <Input
          id={`${formId}-requests`}
          name="dailyRequestLimit"
          type="number"
          min={1}
          step={1}
          defaultValue={values.dailyRequestLimit}
          placeholder="Inherit global"
        />
      </Field>
      <Field
        error={state.fieldErrors?.dailyTokenLimit?.[0]}
        htmlFor={`${formId}-tokens`}
        label="Daily token override"
      >
        <Input
          id={`${formId}-tokens`}
          name="dailyTokenLimit"
          type="number"
          min={1}
          step={1}
          defaultValue={values.dailyTokenLimit}
          placeholder="Inherit global"
        />
      </Field>
      <Button type="submit" pending={pending} size="sm" tone="secondary">
        Save quota override
      </Button>
      <p className="admin-helper-text">
        Leave both fields blank to clear the override.
      </p>
    </form>
  );
}
