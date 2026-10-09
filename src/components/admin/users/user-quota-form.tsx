"use client";

import { useActionState, useId } from "react";
import type { UserAdminActionState } from "@/app/admin/users/actions";

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
    <form action={formAction} aria-label={`Quota override for ${user.name}`}>
      {state.message ? (
        <p role={state.status === "error" ? "alert" : "status"}>
          {state.message}
        </p>
      ) : null}
      <label htmlFor={`${formId}-requests`}>Daily request override</label>
      <input
        id={`${formId}-requests`}
        name="dailyRequestLimit"
        type="number"
        min={1}
        step={1}
        defaultValue={values.dailyRequestLimit}
        placeholder="Inherit global"
      />
      {state.fieldErrors?.dailyRequestLimit?.map((error) => (
        <p key={error}>{error}</p>
      ))}
      <label htmlFor={`${formId}-tokens`}>Daily token override</label>
      <input
        id={`${formId}-tokens`}
        name="dailyTokenLimit"
        type="number"
        min={1}
        step={1}
        defaultValue={values.dailyTokenLimit}
        placeholder="Inherit global"
      />
      {state.fieldErrors?.dailyTokenLimit?.map((error) => (
        <p key={error}>{error}</p>
      ))}
      <button type="submit" disabled={pending}>
        Save quota override
      </button>
      <p>Leave both fields blank to clear the override.</p>
    </form>
  );
}
