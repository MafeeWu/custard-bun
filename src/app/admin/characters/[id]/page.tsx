import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { CharacterEditor } from "@/components/admin/characters/character-editor";
import { VersionHistory } from "@/components/admin/characters/version-history";
import { requireAdmin } from "@/server/admin/require-admin";
import { getAdminCharacterEditorDetail } from "@/server/characters/character-queries";
import { getDatabase } from "@/server/db/database";
import {
  type AdminActionState,
  archiveCharacterAction,
  publishCharacterDraftAction,
  restoreCharacterAction,
  saveCharacterDraftAction,
  setDefaultCharacterVersionAction,
} from "../actions";

export const dynamic = "force-dynamic";

export default async function EditCharacterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin(await headers());
  const { id } = await params;
  const character = await getAdminCharacterEditorDetail(
    await getDatabase(),
    id,
  );
  if (!character) {
    notFound();
  }
  const detail = character;

  async function publishAction(
    state: AdminActionState,
    formData: FormData,
  ) {
    "use server";
    return publishCharacterDraftAction(
      detail.id,
      detail.slug,
      state,
      formData,
    );
  }

  async function setDefaultAction(
    state: AdminActionState,
    formData: FormData,
  ) {
    "use server";
    return setDefaultCharacterVersionAction(
      detail.id,
      detail.slug,
      state,
      formData,
    );
  }

  async function archiveAction(
    state: AdminActionState,
    formData: FormData,
  ) {
    "use server";
    return archiveCharacterAction(
      detail.id,
      detail.slug,
      state,
      formData,
    );
  }

  async function restoreAction(
    state: AdminActionState,
    formData: FormData,
  ) {
    "use server";
    return restoreCharacterAction(
      detail.id,
      detail.slug,
      state,
      formData,
    );
  }

  return (
    <section className="page-stack">
      <h1>Edit {detail.draft.displayName}</h1>
      <CharacterEditor
        mode="edit"
        characterId={detail.id}
        slug={detail.slug}
        draftRevision={detail.draftRevision}
        content={detail.draft}
        action={saveCharacterDraftAction.bind(null, detail.id)}
        publishAction={publishAction}
      />
      <VersionHistory
        characterId={detail.id}
        slug={detail.slug}
        lifecycle={detail.lifecycle}
        defaultVersionId={detail.defaultVersionId}
        versions={detail.versions}
        setDefaultAction={setDefaultAction}
        archiveAction={archiveAction}
        restoreAction={restoreAction}
      />
    </section>
  );
}
