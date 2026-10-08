import Link from "next/link";
import { headers } from "next/headers";
import { requireAdmin } from "@/server/admin/require-admin";
import { listAdminCharacters } from "@/server/characters/character-queries";
import { getDatabase } from "@/server/db/database";

export const dynamic = "force-dynamic";

function versionLabel(value: number | null) {
  return value === null ? "none" : `v${value}`;
}

export default async function AdminCharactersPage() {
  await requireAdmin(await headers());
  const characters = await listAdminCharacters(await getDatabase());

  return (
    <section className="page-stack">
      <header className="page-actions">
        <div>
          <h1>Official characters</h1>
          <p>
            Manage official character drafts, published versions, and defaults.
          </p>
        </div>
        <Link className="brand-link" href="/admin/characters/new">
          Create character
        </Link>
      </header>

      {characters.length === 0 ? <p>No official characters yet.</p> : null}
      <ul className="page-stack">
        {characters.map((character) => (
          <li key={character.id}>
            <article>
              <h2>
                <Link href={`/admin/characters/${character.id}`}>
                  {character.displayName}
                </Link>
              </h2>
              <p>{character.slug}</p>
              <p>{character.lifecycle}</p>
              <p>
                Draft r{character.draftRevision} · base{" "}
                {versionLabel(character.baseVersionNumber)} · default{" "}
                {versionLabel(character.defaultVersionNumber)} · latest{" "}
                {versionLabel(character.latestVersionNumber)}
              </p>
            </article>
          </li>
        ))}
      </ul>
    </section>
  );
}
