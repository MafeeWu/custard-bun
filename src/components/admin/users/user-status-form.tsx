"use client";

import { useActionState, useId } from "react";
import type { UserAdminActionState } from "@/app/admin/users/actions";

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
    <div role={state.status === "error" ? "alert" : "status"}>
      {state.message}
    </div>
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
      <fieldset aria-label={`Restore ${user.name}`}>
        <p>Restore access for {user.email}.</p>
        <form action={restoreFormAction}>
          <ActionFeedback state={restoreActionState} />
          <button type="submit" disabled={restorePending}>
            Restore user
          </button>
        </form>
      </fieldset>
    );
  }

  return (
    <fieldset aria-label={`Disable ${user.name}`}>
      <p>Disable access for {user.email} and sign out all active sessions.</p>
      <form action={disableFormAction}>
        <ActionFeedback state={disableActionState} />
        <label htmlFor={`${formId}-reason`}>Reason for disabling user</label>
        <textarea
          id={`${formId}-reason`}
          name="reason"
          minLength={1}
          maxLength={500}
          required
        />
        <label htmlFor={`${formId}-confirm`}>
          <input
            id={`${formId}-confirm`}
            name="confirm"
            type="checkbox"
            required
          />
          I understand this signs out the user and disables sign-in.
        </label>
        <button type="submit" disabled={disablePending}>
          Disable user
        </button>
      </form>
    </fieldset>
  );
}
