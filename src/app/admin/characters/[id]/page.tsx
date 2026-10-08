import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { CharacterEditor } from "@/components/admin/characters/character-editor";
import { VersionHistory } from "@/components/admin/characters/version-history";
import { requireAdmin } from "@/server/admin/require-admin";
import { getAdminCharacterEditorDetail } from "@/server/characters/character-queries";
import { getDatabase } from "@/server/db/database";
import {
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

  async function publishAction(formData: FormData) {
    "use server";
    await publishCharacterDraftAction(
      detail.id,
      detail.slug,
      { status: "idle" },
      formData,
    );
  }

  async function setDefaultAction(formData: FormData) {
    "use server";
    await setDefaultCharacterVersionAction(
      detail.id,
      detail.slug,
      { status: "idle" },
      formData,
    );
  }

  async function archiveAction(formData: FormData) {
    "use server";
    await archiveCharacterAction(
      detail.id,
      detail.slug,
      { status: "idle" },
      formData,
    );
  }

  async function restoreAction(formData: FormData) {
    "use server";
    await restoreCharacterAction(
      detail.id,
      detail.slug,
      { status: "idle" },
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
