"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useMemo, useState } from "react";
import type { ConversationActionState } from "@/app/app/conversations/actions";
import type {
  ArchivedConversationSummary,
  UserConversationDetail,
} from "@/server/chat/conversation-queries";
import { ChatActions } from "./chat-actions";
import { ChatComposer } from "./chat-composer";
import { ChatHeader } from "./chat-header";
import type { ChatClientMessage } from "./chat-message";
import { ChatTimeline } from "./chat-timeline";

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
  const [serverMessages, setServerMessages] = useState(conversation.messages);
  const router = useRouter();
  if (serverMessages !== conversation.messages) {
    setServerMessages(conversation.messages);
    setMessages(conversation.messages);
  }
  const active = conversation.lifecycle === "active";
  const authoritativeMessageIds = useMemo(
    () => new Set(conversation.messages.map((message) => message.id)),
    [conversation.messages],
  );

  return (
    <div className="chat-page">
      <ChatHeader
        actions={
          <ChatActions
            active={active}
            deleteAction={deleteAction}
            generating={generating}
            restartAction={restartAction}
          />
        }
        character={conversation.character}
        history={archivedConversations}
        memoryHref={`/app/memories/${conversation.character.id}`}
        state={active ? (generating ? "replying" : "available") : "archived"}
      />

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
        <ChatTimeline
          authoritativeMessageIds={authoritativeMessageIds}
          messages={messages}
        />
        {active ? (
          <ChatComposer
            conversationId={conversation.id}
            messages={messages}
            authoritativeMessages={conversation.messages}
            onGeneratingChange={setGenerating}
            onMessagesChange={setMessages}
            onAuthoritativeRefresh={() => router.refresh()}
          />
        ) : (
          <p role="status">This archived conversation is read-only.</p>
        )}
      </section>
    </div>
  );
}
