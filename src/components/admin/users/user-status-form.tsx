"use client";

import { useActionState, useId } from "react";
import type { UserAdminActionState } from "@/app/admin/users/actions";
import { Button } from "@/components/ui/button";
import { CheckboxField, Field, Textarea } from "@/components/ui/field";
import { StatusNotice } from "@/components/ui/status-notice";

export interface UserStatusFormUser {
  id: string;
  name: string;
  email: string;
  banned: boolean;
}

type UserAction = (
  state: UserAdminActionState,
  formData: FormData,
) => Promise<UserAdminActionState>;

const idleState: UserAdminActionState = { status: "idle" };

function ActionFeedback({ state }: { state: UserAdminActionState }) {
  if (!state.message) {
    return null;
  }
  return (
    <StatusNotice tone={state.status === "error" ? "danger" : "success"}>
      {state.message}
    </StatusNotice>
  );
}

export function UserStatusForm({
  user,
  disableAction,
  restoreAction,
  disableState = idleState,
  restoreState = idleState,
}: {
  user: UserStatusFormUser;
  disableAction: UserAction;
  restoreAction: UserAction;
  disableState?: UserAdminActionState;
  restoreState?: UserAdminActionState;
}) {
  const formId = useId();
  const [disableActionState, disableFormAction, disablePending] =
    useActionState(disableAction, disableState);
  const [restoreActionState, restoreFormAction, restorePending] =
    useActionState(restoreAction, restoreState);

  if (user.banned) {
    return (
      <fieldset
        aria-label={`Restore ${user.name}`}
        className="admin-action-fieldset"
      >
        <p>Restore access for {user.email}.</p>
        <form action={restoreFormAction} className="admin-inline-form">
          <ActionFeedback state={restoreActionState} />
          <Button
            type="submit"
            pending={restorePending}
            size="sm"
            tone="secondary"
          >
            Restore user
          </Button>
        </form>
      </fieldset>
    );
  }

  return (
    <fieldset
      aria-label={`Disable ${user.name}`}
      className="admin-action-fieldset"
    >
      <p>Disable access for {user.email} and sign out all active sessions.</p>
      <form action={disableFormAction} className="admin-inline-form">
        <ActionFeedback state={disableActionState} />
        <Field htmlFor={`${formId}-reason`} label="Reason for disabling user">
          <Textarea
            id={`${formId}-reason`}
            name="reason"
            minLength={1}
            maxLength={500}
            required
            rows={3}
          />
        </Field>
        <CheckboxField
          id={`${formId}-confirm`}
          name="confirm"
          required
          label="I understand this signs out the user and disables sign-in."
        />
        <Button type="submit" pending={disablePending} size="sm" tone="danger">
          Disable user
        </Button>
      </form>
    </fieldset>
  );
}
