"use client";

import { useActionState, type ReactNode } from "react";
import type { AdminActionState } from "@/app/admin/characters/actions";
import { AdminSection } from "@/components/admin/admin-section";
import { Button } from "@/components/ui/button";
import { StatusNotice } from "@/components/ui/status-notice";
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
    <StatusNotice tone={state.status === "error" ? "danger" : "success"}>
      {state.message ? <p>{state.message}</p> : null}
      {fieldMessages.length > 0 ? (
        <ul className="admin-field-errors">
          {fieldMessages.map(({ key, message }) => (
            <li key={key}>{message}</li>
          ))}
        </ul>
      ) : null}
    </StatusNotice>
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
    <form action={formAction} className="admin-inline-form">
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
    <AdminSection title="Version history" className="admin-version-history">
      {versions.length === 0 ? <p>No published versions yet.</p> : null}
      <ol className="admin-version-history__list">
        {versions.map((version) => (
          <li className="admin-version-history__item" key={version.id}>
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
                  <Button
                    type="submit"
                    disabled={version.id === defaultVersionId}
                    pending={pending}
                    size="sm"
                    tone="secondary"
                  >
                    Set version {version.versionNumber} as default
                  </Button>
                </>
              )}
            </StatefulActionForm>
          </li>
        ))}
      </ol>

      {lifecycle === "active" ? (
        <fieldset
          aria-label="Archive character"
          className="admin-action-fieldset"
        >
          <p>
            Archive removes this character from public selection without
            deleting history.
          </p>
          <StatefulActionForm
            action={archiveAction}
            initialState={archiveActionState}
          >
            {(pending) => (
              <Button type="submit" pending={pending} size="sm" tone="danger">
                Archive character
              </Button>
            )}
          </StatefulActionForm>
        </fieldset>
      ) : (
        <fieldset
          aria-label="Restore character"
          className="admin-action-fieldset"
        >
          <p>
            Restore makes this character eligible for public selection again.
          </p>
          <StatefulActionForm
            action={restoreAction}
            initialState={restoreActionState}
          >
            {(pending) => (
              <Button
                type="submit"
                pending={pending}
                size="sm"
                tone="secondary"
              >
                Restore character
              </Button>
            )}
          </StatefulActionForm>
        </fieldset>
      )}
    </AdminSection>
  );
}
