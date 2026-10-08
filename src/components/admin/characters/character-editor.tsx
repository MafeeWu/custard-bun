"use client";

import Link from "next/link";
import { useActionState, useId, useState, type ChangeEvent } from "react";
import type { CharacterContent } from "@/server/characters/character-content";
import type { AdminActionState } from "@/app/admin/characters/actions";

type EditorAction = (
  state: AdminActionState,
  formData: FormData,
) => Promise<AdminActionState>;

type PublishAction = (
  state: AdminActionState,
  formData: FormData,
) => Promise<AdminActionState>;

export interface CharacterEditorProps {
  mode: "create" | "edit";
  characterId?: string;
  slug?: string;
  draftRevision?: number;
  content: CharacterContent;
  action: EditorAction;
  publishAction?: PublishAction;
  state?: AdminActionState;
  publishState?: AdminActionState;
}

const idleState: AdminActionState = { status: "idle" };

async function noopAction() {
  return idleState;
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

function initialEditor(
  content: CharacterContent,
  slug: string | undefined,
  revision: number | undefined,
) {
  return {
    revision,
    fields: {
      slug: slug ?? "",
      displayName: content.displayName,
      avatarPath: content.avatarPath,
      shortDescription: content.shortDescription,
      longDescription: content.longDescription,
      personalityPrinciples: textAreaValue(content.personalityPrinciples),
      speakingStyle: content.speakingStyle,
      responseRhythm: content.responseRhythm,
      relationshipBoundaries: textAreaValue(content.relationshipBoundaries),
      openingMessage: content.openingMessage,
      temperature: String(content.generationParameters.temperature),
      topP: String(content.generationParameters.topP),
      maxOutputTokens: String(content.generationParameters.maxOutputTokens),
      safetyAdditions: textAreaValue(content.safetyAdditions),
    },
    examples:
      content.exampleConversations.length > 0
        ? content.exampleConversations.map((example) => ({ ...example }))
        : [{ user: "", assistant: "" }],
  };
}

function ActionFeedback({
  state,
  showFieldErrors = false,
}: {
  state: AdminActionState;
  showFieldErrors?: boolean;
}) {
  if (!state.message && (!showFieldErrors || !state.fieldErrors)) {
    return null;
  }
  const fieldMessages = showFieldErrors
    ? Object.entries(state.fieldErrors ?? {}).flatMap(([field, messages]) =>
        messages.map((message) => ({
          key: `${field}-${message}`,
          message,
        })),
      )
    : [];
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

export function CharacterEditor({
  mode,
  characterId,
  slug,
  draftRevision,
  content,
  action,
  publishAction,
  state = { status: "idle" },
  publishState = { status: "idle" },
}: CharacterEditorProps) {
  const formId = useId();
  // Refreshed props must never rebase locally edited fields onto a newer draft.
  const [editor, setEditor] = useState(() =>
    initialEditor(content, slug, draftRevision),
  );

  function advanceRevision(result: AdminActionState, submitted: FormData) {
    const revision = result.draftRevision;
    if (result.status === "success" && revision !== undefined) {
      const expectedRevision = Number(submitted.get("expectedRevision"));
      setEditor((current) =>
        current.revision === expectedRevision
          ? { ...current, revision }
          : current,
      );
    }
  }

  const [actionState, formAction, pending] = useActionState(
    async (previous: AdminActionState, submitted: FormData) => {
      const result = await action(previous, submitted);
      advanceRevision(result, submitted);
      return result;
    },
    state,
  );
  const [publishActionState, publishFormAction, publishPending] =
    useActionState(async (previous: AdminActionState, submitted: FormData) => {
      const result = await (publishAction ?? noopAction)(previous, submitted);
      advanceRevision(result, submitted);
      return result;
    }, publishState);
  const { examples } = editor;

  function field(name: keyof typeof editor.fields) {
    return {
      value: editor.fields[name],
      onChange(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
        const value = event.currentTarget.value;
        setEditor((current) => ({
          ...current,
          fields: { ...current.fields, [name]: value },
        }));
      },
    };
  }

  function changeExample(
    index: number,
    side: "user" | "assistant",
    value: string,
  ) {
    setEditor((current) => ({
      ...current,
      examples: current.examples.map((example, position) =>
        position === index ? { ...example, [side]: value } : example,
      ),
    }));
  }

  return (
    <div className="page-stack">
      <ActionFeedback state={actionState} />
      {draftRevision !== undefined &&
      editor.revision !== undefined &&
      draftRevision > editor.revision ? (
        <p role="note">
          A newer draft is available. Your changes still use revision{" "}
          {editor.revision}. Copy your changes and reload before editing the
          newer draft.
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
              {...field("slug")}
              required
            />
            <FieldError messages={actionState.fieldErrors?.slug} />
          </>
        ) : null}

        {editor.revision === undefined ? null : (
          <input
            type="hidden"
            name="expectedRevision"
            value={editor.revision}
            readOnly
          />
        )}

        <label htmlFor={`${formId}-displayName`}>Display name</label>
        <input
          id={`${formId}-displayName`}
          name="displayName"
          {...field("displayName")}
          required
        />
        <FieldError messages={actionState.fieldErrors?.displayName} />

        <label htmlFor={`${formId}-avatarPath`}>Avatar path</label>
        <input
          id={`${formId}-avatarPath`}
          name="avatarPath"
          {...field("avatarPath")}
          required
        />
        <FieldError messages={actionState.fieldErrors?.avatarPath} />

        <label htmlFor={`${formId}-shortDescription`}>Short description</label>
        <textarea
          id={`${formId}-shortDescription`}
          name="shortDescription"
          {...field("shortDescription")}
          required
        />
        <FieldError messages={actionState.fieldErrors?.shortDescription} />

        <label htmlFor={`${formId}-longDescription`}>Long description</label>
        <textarea
          id={`${formId}-longDescription`}
          name="longDescription"
          {...field("longDescription")}
          required
        />
        <FieldError messages={actionState.fieldErrors?.longDescription} />

        <label htmlFor={`${formId}-personalityPrinciples`}>
          Personality principles
        </label>
        <textarea
          id={`${formId}-personalityPrinciples`}
          name="personalityPrinciples"
          {...field("personalityPrinciples")}
          required
        />
        <FieldError messages={actionState.fieldErrors?.personalityPrinciples} />

        <label htmlFor={`${formId}-speakingStyle`}>Speaking style</label>
        <textarea
          id={`${formId}-speakingStyle`}
          name="speakingStyle"
          {...field("speakingStyle")}
          required
        />
        <FieldError messages={actionState.fieldErrors?.speakingStyle} />

        <label htmlFor={`${formId}-responseRhythm`}>Response rhythm</label>
        <textarea
          id={`${formId}-responseRhythm`}
          name="responseRhythm"
          {...field("responseRhythm")}
          required
        />
        <FieldError messages={actionState.fieldErrors?.responseRhythm} />

        <label htmlFor={`${formId}-relationshipBoundaries`}>
          Relationship boundaries
        </label>
        <textarea
          id={`${formId}-relationshipBoundaries`}
          name="relationshipBoundaries"
          {...field("relationshipBoundaries")}
          required
        />
        <FieldError
          messages={actionState.fieldErrors?.relationshipBoundaries}
        />

        <label htmlFor={`${formId}-openingMessage`}>Opening message</label>
        <textarea
          id={`${formId}-openingMessage`}
          name="openingMessage"
          {...field("openingMessage")}
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
                value={example.user}
                onChange={(event) =>
                  changeExample(index, "user", event.currentTarget.value)
                }
              />
              <label htmlFor={`${formId}-exampleAssistant-${index}`}>
                Example assistant {index + 1}
              </label>
              <textarea
                id={`${formId}-exampleAssistant-${index}`}
                name="exampleAssistant"
                value={example.assistant}
                onChange={(event) =>
                  changeExample(index, "assistant", event.currentTarget.value)
                }
              />
              <button
                type="button"
                aria-label={`Remove example ${index + 1}`}
                disabled={examples.length <= 1}
                onClick={() =>
                  setEditor((current) =>
                    current.examples.length <= 1
                      ? current
                      : {
                          ...current,
                          examples: current.examples.filter(
                            (_, position) => position !== index,
                          ),
                        },
                  )
                }
              >
                Remove example {index + 1}
              </button>
            </div>
          ))}
          <button
            type="button"
            disabled={examples.length >= 6}
            onClick={() =>
              setEditor((current) =>
                current.examples.length >= 6
                  ? current
                  : {
                      ...current,
                      examples: [
                        ...current.examples,
                        { user: "", assistant: "" },
                      ],
                    },
              )
            }
          >
            Add example conversation
          </button>
          <p aria-live="polite">
            {examples.length} of 6 example conversations.
          </p>
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
          {...field("temperature")}
          required
        />
        <FieldError messages={actionState.fieldErrors?.temperature} />

        <label htmlFor={`${formId}-topP`}>Top P</label>
        <input
          id={`${formId}-topP`}
          name="topP"
          type="number"
          step="0.01"
          {...field("topP")}
          required
        />
        <FieldError messages={actionState.fieldErrors?.topP} />

        <label htmlFor={`${formId}-maxOutputTokens`}>Max output tokens</label>
        <input
          id={`${formId}-maxOutputTokens`}
          name="maxOutputTokens"
          type="number"
          step="1"
          {...field("maxOutputTokens")}
          required
        />
        <FieldError messages={actionState.fieldErrors?.maxOutputTokens} />

        <label htmlFor={`${formId}-safetyAdditions`}>Safety additions</label>
        <textarea
          id={`${formId}-safetyAdditions`}
          name="safetyAdditions"
          {...field("safetyAdditions")}
        />
        <FieldError messages={actionState.fieldErrors?.safetyAdditions} />

        <button type="submit" disabled={pending || publishPending}>
          {mode === "create" ? "Create draft" : "Save draft"}
        </button>
      </form>

      {mode === "edit" && characterId && publishAction ? (
        <div className="page-actions">
          <Link href={`/admin/characters/${characterId}/preview`}>
            Preview persisted draft
          </Link>
          <form action={publishFormAction}>
            <ActionFeedback state={publishActionState} showFieldErrors />
            <input
              type="hidden"
              name="expectedRevision"
              value={editor.revision}
              readOnly
            />
            <button type="submit" disabled={pending || publishPending}>
              Publish draft
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
