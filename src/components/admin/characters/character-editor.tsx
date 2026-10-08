"use client";

import Link from "next/link";
import { useActionState, useId } from "react";
import type { CharacterContent } from "@/server/characters/character-content";
import type { AdminActionState } from "@/app/admin/characters/actions";

type EditorAction = (
  state: AdminActionState,
  formData: FormData,
) => Promise<AdminActionState>;

type PublishAction = (formData: FormData) => void | Promise<void>;

export interface CharacterEditorProps {
  mode: "create" | "edit";
  characterId?: string;
  slug?: string;
  draftRevision?: number;
  content: CharacterContent;
  action: EditorAction;
  publishAction?: PublishAction;
  state?: AdminActionState;
}

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages?.length) {
    return null;
  }
  return (
    <ul className="admin-field-errors">
      {messages.map((message) => (
        <li key={message}>{message}</li>
      ))}
    </ul>
  );
}

function textAreaValue(values: string[]) {
  return values.join("\n");
}

export function CharacterEditor({
  mode,
  characterId,
  slug,
  draftRevision,
  content,
  action,
  publishAction,
  state = { status: "idle" },
}: CharacterEditorProps) {
  const formId = useId();
  const [actionState, formAction, pending] = useActionState(action, state);
  const examples =
    content.exampleConversations.length > 0
      ? content.exampleConversations
      : [{ user: "", assistant: "" }];

  return (
    <div className="page-stack">
      {actionState.message ? (
        <p role={actionState.status === "error" ? "alert" : "status"}>
          {actionState.message}
        </p>
      ) : null}

      <form
        action={formAction}
        aria-label="Character editor"
        className="page-stack"
      >
        {mode === "create" ? (
          <>
            <label htmlFor={`${formId}-slug`}>Slug</label>
            <input
              id={`${formId}-slug`}
              name="slug"
              defaultValue={slug}
              required
            />
            <FieldError messages={actionState.fieldErrors?.slug} />
          </>
        ) : null}

        {draftRevision === undefined ? null : (
          <input
            type="hidden"
            name="expectedRevision"
            value={draftRevision}
            readOnly
          />
        )}

        <label htmlFor={`${formId}-displayName`}>Display name</label>
        <input
          id={`${formId}-displayName`}
          name="displayName"
          defaultValue={content.displayName}
          required
        />
        <FieldError messages={actionState.fieldErrors?.displayName} />

        <label htmlFor={`${formId}-avatarPath`}>Avatar path</label>
        <input
          id={`${formId}-avatarPath`}
          name="avatarPath"
          defaultValue={content.avatarPath}
          required
        />
        <FieldError messages={actionState.fieldErrors?.avatarPath} />

        <label htmlFor={`${formId}-shortDescription`}>Short description</label>
        <textarea
          id={`${formId}-shortDescription`}
          name="shortDescription"
          defaultValue={content.shortDescription}
          required
        />
        <FieldError messages={actionState.fieldErrors?.shortDescription} />

        <label htmlFor={`${formId}-longDescription`}>Long description</label>
        <textarea
          id={`${formId}-longDescription`}
          name="longDescription"
          defaultValue={content.longDescription}
          required
        />
        <FieldError messages={actionState.fieldErrors?.longDescription} />

        <label htmlFor={`${formId}-personalityPrinciples`}>
          Personality principles
        </label>
        <textarea
          id={`${formId}-personalityPrinciples`}
          name="personalityPrinciples"
          defaultValue={textAreaValue(content.personalityPrinciples)}
          required
        />
        <FieldError messages={actionState.fieldErrors?.personalityPrinciples} />

        <label htmlFor={`${formId}-speakingStyle`}>Speaking style</label>
        <textarea
          id={`${formId}-speakingStyle`}
          name="speakingStyle"
          defaultValue={content.speakingStyle}
          required
        />
        <FieldError messages={actionState.fieldErrors?.speakingStyle} />

        <label htmlFor={`${formId}-responseRhythm`}>Response rhythm</label>
        <textarea
          id={`${formId}-responseRhythm`}
          name="responseRhythm"
          defaultValue={content.responseRhythm}
          required
        />
        <FieldError messages={actionState.fieldErrors?.responseRhythm} />

        <label htmlFor={`${formId}-relationshipBoundaries`}>
          Relationship boundaries
        </label>
        <textarea
          id={`${formId}-relationshipBoundaries`}
          name="relationshipBoundaries"
          defaultValue={textAreaValue(content.relationshipBoundaries)}
          required
        />
        <FieldError
          messages={actionState.fieldErrors?.relationshipBoundaries}
        />

        <label htmlFor={`${formId}-openingMessage`}>Opening message</label>
        <textarea
          id={`${formId}-openingMessage`}
          name="openingMessage"
          defaultValue={content.openingMessage}
          required
        />
        <FieldError messages={actionState.fieldErrors?.openingMessage} />

        <fieldset>
          <legend>Example conversations</legend>
          {examples.map((example, index) => (
            <div key={index}>
              <label htmlFor={`${formId}-exampleUser-${index}`}>
                Example user {index + 1}
              </label>
              <textarea
                id={`${formId}-exampleUser-${index}`}
                name="exampleUser"
                defaultValue={example.user}
              />
              <label htmlFor={`${formId}-exampleAssistant-${index}`}>
                Example assistant {index + 1}
              </label>
              <textarea
                id={`${formId}-exampleAssistant-${index}`}
                name="exampleAssistant"
                defaultValue={example.assistant}
              />
            </div>
          ))}
          <FieldError messages={actionState.fieldErrors?.exampleUser} />
          <FieldError messages={actionState.fieldErrors?.exampleAssistant} />
          <FieldError
            messages={actionState.fieldErrors?.exampleConversations}
          />
        </fieldset>

        <label htmlFor={`${formId}-temperature`}>Temperature</label>
        <input
          id={`${formId}-temperature`}
          name="temperature"
          type="number"
          step="0.01"
          defaultValue={content.generationParameters.temperature}
          required
        />
        <FieldError messages={actionState.fieldErrors?.temperature} />

        <label htmlFor={`${formId}-topP`}>Top P</label>
        <input
          id={`${formId}-topP`}
          name="topP"
          type="number"
          step="0.01"
          defaultValue={content.generationParameters.topP}
          required
        />
        <FieldError messages={actionState.fieldErrors?.topP} />

        <label htmlFor={`${formId}-maxOutputTokens`}>Max output tokens</label>
        <input
          id={`${formId}-maxOutputTokens`}
          name="maxOutputTokens"
          type="number"
          step="1"
          defaultValue={content.generationParameters.maxOutputTokens}
          required
        />
        <FieldError messages={actionState.fieldErrors?.maxOutputTokens} />

        <label htmlFor={`${formId}-safetyAdditions`}>Safety additions</label>
        <textarea
          id={`${formId}-safetyAdditions`}
          name="safetyAdditions"
          defaultValue={textAreaValue(content.safetyAdditions)}
        />
        <FieldError messages={actionState.fieldErrors?.safetyAdditions} />

        <button type="submit" disabled={pending}>
          {mode === "create" ? "Create draft" : "Save draft"}
        </button>
      </form>

      {mode === "edit" && characterId && publishAction ? (
        <div className="page-actions">
          <Link href={`/admin/characters/${characterId}/preview`}>
            Preview persisted draft
          </Link>
          <form action={publishAction}>
            <input
              type="hidden"
              name="expectedRevision"
              value={draftRevision}
              readOnly
            />
            <button type="submit">Publish draft</button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
