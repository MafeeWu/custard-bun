"use client";

import { useActionState, type ReactNode } from "react";
import type { AdminActionState } from "@/app/admin/characters/actions";
import type { CharacterLifecycle } from "@/server/db/character-schema";

type Action = (
  state: AdminActionState,
  formData: FormData,
) => Promise<AdminActionState>;

export interface VersionHistoryItem {
  id: string;
  versionNumber: number;
  displayName: string;
  publishedAt: Date;
}

const idleState: AdminActionState = { status: "idle" };

function ActionFeedback({ state }: { state: AdminActionState }) {
  if (!state.message && !state.fieldErrors) {
    return null;
  }
  const fieldMessages = Object.entries(state.fieldErrors ?? {}).flatMap(
    ([field, messages]) =>
      messages.map((message) => ({
        key: `${field}-${message}`,
        message,
      })),
  );
  return (
    <div role={state.status === "error" ? "alert" : "status"}>
      {state.message ? <p>{state.message}</p> : null}
      {fieldMessages.length > 0 ? (
        <ul className="admin-field-errors">
          {fieldMessages.map(({ key, message }) => (
            <li key={key}>{message}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function StatefulActionForm({
  action,
  children,
  initialState = idleState,
}: {
  action: Action;
  children: (pending: boolean) => ReactNode;
  initialState?: AdminActionState;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  return (
    <form action={formAction}>
      <ActionFeedback state={state} />
      {children(pending)}
    </form>
  );
}

export function VersionHistory({
  lifecycle,
  defaultVersionId,
  versions,
  setDefaultAction,
  archiveAction,
  restoreAction,
  defaultActionStates = {},
  archiveActionState = idleState,
  restoreActionState = idleState,
}: {
  characterId: string;
  slug: string;
  lifecycle: CharacterLifecycle;
  defaultVersionId: string | null;
  versions: VersionHistoryItem[];
  setDefaultAction: Action;
  archiveAction: Action;
  restoreAction: Action;
  defaultActionStates?: Record<string, AdminActionState>;
  archiveActionState?: AdminActionState;
  restoreActionState?: AdminActionState;
}) {
  return (
    <section className="page-stack" aria-labelledby="version-history-heading">
      <h2 id="version-history-heading">Version history</h2>
      {versions.length === 0 ? <p>No published versions yet.</p> : null}
      <ol>
        {versions.map((version) => (
          <li key={version.id}>
            <h3>Version {version.versionNumber}</h3>
            <p>{version.displayName}</p>
            <p>Published {version.publishedAt.toISOString()}</p>
            {version.id === defaultVersionId ? <p>Current default</p> : null}
            <StatefulActionForm
              action={setDefaultAction}
              initialState={defaultActionStates[version.id] ?? idleState}
            >
              {(pending) => (
                <>
                  <input
                    type="hidden"
                    name="versionId"
                    value={version.id}
                    readOnly
                  />
                  <button
                    type="submit"
                    disabled={version.id === defaultVersionId || pending}
                  >
                    Set version {version.versionNumber} as default
                  </button>
                </>
              )}
            </StatefulActionForm>
          </li>
        ))}
      </ol>

      {lifecycle === "active" ? (
        <fieldset aria-label="Archive character">
          <p>
            Archive removes this character from public selection without
            deleting history.
          </p>
          <StatefulActionForm
            action={archiveAction}
            initialState={archiveActionState}
          >
            {(pending) => (
              <button type="submit" disabled={pending}>
                Archive character
              </button>
            )}
          </StatefulActionForm>
        </fieldset>
      ) : (
        <fieldset aria-label="Restore character">
          <p>
            Restore makes this character eligible for public selection again.
          </p>
          <StatefulActionForm
            action={restoreAction}
            initialState={restoreActionState}
          >
            {(pending) => (
              <button type="submit" disabled={pending}>
                Restore character
              </button>
            )}
          </StatefulActionForm>
        </fieldset>
      )}
    </section>
  );
}
