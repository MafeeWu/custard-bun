import type { CharacterLifecycle } from "@/server/db/character-schema";

type Action = (formData: FormData) => void | Promise<void>;

export interface VersionHistoryItem {
  id: string;
  versionNumber: number;
  displayName: string;
  publishedAt: Date;
}

export function VersionHistory({
  lifecycle,
  defaultVersionId,
  versions,
  setDefaultAction,
  archiveAction,
  restoreAction,
}: {
  characterId: string;
  slug: string;
  lifecycle: CharacterLifecycle;
  defaultVersionId: string | null;
  versions: VersionHistoryItem[];
  setDefaultAction: Action;
  archiveAction: Action;
  restoreAction: Action;
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
            <form action={setDefaultAction}>
              <input
                type="hidden"
                name="versionId"
                value={version.id}
                readOnly
              />
              <button type="submit" disabled={version.id === defaultVersionId}>
                Set version {version.versionNumber} as default
              </button>
            </form>
          </li>
        ))}
      </ol>

      {lifecycle === "active" ? (
        <fieldset aria-label="Archive character">
          <p>
            Archive removes this character from public selection without
            deleting history.
          </p>
          <form action={archiveAction}>
            <button type="submit">Archive character</button>
          </form>
        </fieldset>
      ) : (
        <fieldset aria-label="Restore character">
          <p>
            Restore makes this character eligible for public selection again.
          </p>
          <form action={restoreAction}>
            <button type="submit">Restore character</button>
          </form>
        </fieldset>
      )}
    </section>
  );
}
