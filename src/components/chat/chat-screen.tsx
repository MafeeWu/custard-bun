"use client";

import Image from "next/image";
import Link from "next/link";
import { useActionState, useState } from "react";
import type { ConversationActionState } from "@/app/app/conversations/actions";
import type {
  ArchivedConversationSummary,
  UserConversationDetail,
} from "@/server/chat/conversation-queries";
import { ChatComposer } from "./chat-composer";
import type { ChatClientMessage } from "./chat-message";
import { ChatTimeline } from "./chat-timeline";
import { ConversationHistory } from "./conversation-history";

export type ConversationAction = (
  state: ConversationActionState,
  formData: FormData,
) => Promise<ConversationActionState>;

const idleState: ConversationActionState = { status: "idle" };

export function StartConversationForm({
  action,
  label,
}: {
  action: ConversationAction;
  label: string;
}) {
  const [state, formAction, pending] = useActionState(action, idleState);
  return (
    <form action={formAction}>
      <button className="brand-primary" disabled={pending} type="submit">
        {pending ? "Opening…" : label}
      </button>
      {state.message ? (
        <p role={state.status === "error" ? "alert" : "status"}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

function ConfirmAction({
  action,
  label,
  confirmation,
  disabled = false,
}: {
  action: ConversationAction;
  label: string;
  confirmation: string;
  disabled?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, idleState);
  return (
    <form action={formAction} className="chat-confirm-action">
      <label>
        <input
          disabled={disabled || pending}
          name="confirm"
          required
          type="checkbox"
        />{" "}
        {confirmation}
      </label>
      <button disabled={disabled || pending} type="submit">
        {pending ? "Working…" : label}
      </button>
      {state.message ? (
        <p role={state.status === "error" ? "alert" : "status"}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

export function ChatScreen({
  conversation,
  archivedConversations,
  activeConversationId,
  restartAction,
  deleteAction,
}: {
  conversation: UserConversationDetail;
  archivedConversations: ArchivedConversationSummary[];
  activeConversationId?: string;
  restartAction: ConversationAction;
  deleteAction: ConversationAction;
}) {
  const [messages, setMessages] = useState<ChatClientMessage[]>(
    conversation.messages,
  );
  const [generating, setGenerating] = useState(false);
  const active = conversation.lifecycle === "active";

  return (
    <main className="chat-page">
      <header className="chat-header">
        <div className="chat-character">
          <Image
            alt=""
            height={56}
            src={conversation.character.avatarPath}
            width={56}
          />
          <div>
            <p className="character-eyebrow">
              {active ? (generating ? "Replying" : "Available") : "Archived"}
            </p>
            <h1>{conversation.character.displayName}</h1>
          </div>
        </div>
        <div className="chat-header-actions">
          <ConversationHistory conversations={archivedConversations} />
          {active ? (
            <details className="chat-disclosure">
              <summary role="button">Conversation actions</summary>
              <div className="chat-action-menu">
                <ConfirmAction
                  action={restartAction}
                  confirmation="Archive this conversation and start over."
                  disabled={generating}
                  label="Start over"
                />
                <ConfirmAction
                  action={deleteAction}
                  confirmation="Permanently delete this conversation."
                  disabled={generating}
                  label="Delete conversation"
                />
              </div>
            </details>
          ) : (
            <div className="chat-archived-action">
              <ConfirmAction
                action={deleteAction}
                confirmation="Permanently delete this conversation."
                disabled={generating}
                label="Delete conversation"
              />
            </div>
          )}
        </div>
      </header>

      {!conversation.character.isCurrentDefault ? (
        <p className="chat-version-notice" role="note">
          This conversation keeps the character version it started with. Start
          over to use the current version.
        </p>
      ) : null}

      {!active && activeConversationId ? (
        <Link
          className="brand-link"
          href={`/app/conversations/${activeConversationId}`}
        >
          Back to current conversation
        </Link>
      ) : (
        <Link className="brand-link" href="/app">
          Back to conversations
        </Link>
      )}

      <section aria-label="Conversation" className="chat-conversation">
        <ChatTimeline messages={messages} />
        {active ? (
          <ChatComposer
            conversationId={conversation.id}
            messages={messages}
            onGeneratingChange={setGenerating}
            onMessagesChange={setMessages}
          />
        ) : (
          <p role="status">This archived conversation is read-only.</p>
        )}
      </section>
    </main>
  );
}
