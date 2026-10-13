"use client";

import { useActionState, useId, useState, type ChangeEvent } from "react";
import { Button, LinkButton } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { StatusNotice } from "@/components/ui/status-notice";
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

  function inputField(
    name: keyof typeof editor.fields,
    label: string,
    options: { type?: string; step?: string; required?: boolean } = {},
  ) {
    const id = `${formId}-${name}`;
    return (
      <>
        <Field htmlFor={id} label={label}>
          <Input
            id={id}
            name={name}
            type={options.type}
            step={options.step}
            required={options.required}
            {...field(name)}
          />
        </Field>
        <FieldError messages={actionState.fieldErrors?.[name]} />
      </>
    );
  }

  function textareaField(
    name: keyof typeof editor.fields,
    label: string,
    required = true,
  ) {
    const id = `${formId}-${name}`;
    return (
      <>
        <Field htmlFor={id} label={label}>
          <Textarea id={id} name={name} required={required} {...field(name)} />
        </Field>
        <FieldError messages={actionState.fieldErrors?.[name]} />
      </>
    );
  }

  return (
    <div className="admin-character-editor page-stack">
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
        className="admin-character-editor__form page-stack"
      >
        {mode === "create"
          ? inputField("slug", "Slug", { required: true })
          : null}

        {editor.revision === undefined ? null : (
          <input
            type="hidden"
            name="expectedRevision"
            value={editor.revision}
            readOnly
          />
        )}

        {inputField("displayName", "Display name", { required: true })}
        {inputField("avatarPath", "Avatar path", { required: true })}
        {textareaField("shortDescription", "Short description")}
        {textareaField("longDescription", "Long description")}
        {textareaField("personalityPrinciples", "Personality principles")}
        {textareaField("speakingStyle", "Speaking style")}
        {textareaField("responseRhythm", "Response rhythm")}
        {textareaField("relationshipBoundaries", "Relationship boundaries")}
        {textareaField("openingMessage", "Opening message")}

        <fieldset className="admin-character-editor__fieldset">
          <legend>Example conversations</legend>
          {examples.map((example, index) => (
            <div className="admin-character-editor__example" key={index}>
              <Field
                htmlFor={`${formId}-exampleUser-${index}`}
                label={`Example user ${index + 1}`}
              >
                <Textarea
                  id={`${formId}-exampleUser-${index}`}
                  name="exampleUser"
                  value={example.user}
                  onChange={(event) =>
                    changeExample(index, "user", event.currentTarget.value)
                  }
                />
              </Field>
              <Field
                htmlFor={`${formId}-exampleAssistant-${index}`}
                label={`Example assistant ${index + 1}`}
              >
                <Textarea
                  id={`${formId}-exampleAssistant-${index}`}
                  name="exampleAssistant"
                  value={example.assistant}
                  onChange={(event) =>
                    changeExample(index, "assistant", event.currentTarget.value)
                  }
                />
              </Field>
              <Button
                type="button"
                aria-label={`Remove example ${index + 1}`}
                disabled={examples.length <= 1}
                size="sm"
                tone="quiet"
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
              </Button>
            </div>
          ))}
          <Button
            type="button"
            disabled={examples.length >= 6}
            size="sm"
            tone="secondary"
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
          </Button>
          <p aria-live="polite">
            {examples.length} of 6 example conversations.
          </p>
          <FieldError messages={actionState.fieldErrors?.exampleUser} />
          <FieldError messages={actionState.fieldErrors?.exampleAssistant} />
          <FieldError
            messages={actionState.fieldErrors?.exampleConversations}
          />
        </fieldset>

        {inputField("temperature", "Temperature", {
          type: "number",
          step: "0.01",
          required: true,
        })}
        {inputField("topP", "Top P", {
          type: "number",
          step: "0.01",
          required: true,
        })}
        {inputField("maxOutputTokens", "Max output tokens", {
          type: "number",
          step: "1",
          required: true,
        })}
        {textareaField("safetyAdditions", "Safety additions", false)}

        <div className="admin-character-editor__sticky-actions">
          <Button type="submit" disabled={pending || publishPending}>
            {mode === "create" ? "Create draft" : "Save draft"}
          </Button>
        </div>
      </form>

      {mode === "edit" && characterId && publishAction ? (
        <div className="admin-character-editor__publish page-actions">
          <LinkButton
            href={`/admin/characters/${characterId}/preview`}
            tone="secondary"
          >
            Preview persisted draft
          </LinkButton>
          <form action={publishFormAction} className="admin-inline-form">
            <ActionFeedback state={publishActionState} showFieldErrors />
            <input
              type="hidden"
              name="expectedRevision"
              value={editor.revision}
              readOnly
            />
            <Button type="submit" disabled={pending || publishPending}>
              Publish draft
            </Button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
