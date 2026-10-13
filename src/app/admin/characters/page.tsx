import Link from "next/link";
import { headers } from "next/headers";
import { AdminDataList } from "@/components/admin/admin-data-list";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { LinkButton } from "@/components/ui/button";
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
    <section className="admin-page">
      <AdminPageHeader
        title="Official characters"
        description="Manage official character drafts, published versions, and defaults."
        actions={
          <LinkButton href="/admin/characters/new">Create character</LinkButton>
        }
      />
      <AdminDataList
        ariaLabel="Official characters"
        columns={[
          {
            key: "character",
            header: "Character",
            priority: "primary",
            cell: (character) => (
              <Link
                className="admin-row-link"
                href={`/admin/characters/${character.id}`}
              >
                {character.displayName}
              </Link>
            ),
          },
          {
            key: "slug",
            header: "Slug",
            priority: "secondary",
            cell: (character) => <code>{character.slug}</code>,
          },
          {
            key: "lifecycle",
            header: "Lifecycle",
            priority: "secondary",
            cell: (character) => (
              <span className="admin-status-pill">{character.lifecycle}</span>
            ),
          },
          {
            key: "versions",
            header: "Versions",
            priority: "detail",
            cell: (character) =>
              `Draft r${character.draftRevision} · base ${versionLabel(
                character.baseVersionNumber,
              )} · default ${versionLabel(
                character.defaultVersionNumber,
              )} · latest ${versionLabel(character.latestVersionNumber)}`,
          },
        ]}
        emptyDescription="Create a draft before publishing an official character."
        emptyTitle="No official characters yet."
        getRowKey={(character) => character.id}
        rows={characters}
      />
    </section>
  );
}
