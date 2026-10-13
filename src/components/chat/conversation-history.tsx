"use client";

import { ClockCounterClockwise, X } from "@phosphor-icons/react";
import Link from "next/link";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { IconButton } from "@/components/ui/icon-button";
import type { ArchivedConversationSummary } from "@/server/chat/conversation-queries";

const dateFormatter = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
});

export function ConversationHistory({
  conversations,
}: {
  conversations: ArchivedConversationSummary[];
}) {
  const [open, setOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <Button
        aria-label="Open conversation history"
        className="chat-header-action"
        onClick={() => setOpen(true)}
        size="sm"
        tone="secondary"
        type="button"
      >
        <ClockCounterClockwise aria-hidden="true" size={18} weight="bold" />
        History
      </Button>
      <Drawer
        description="Review archived conversations for this character."
        initialFocusRef={closeButtonRef}
        onOpenChange={setOpen}
        open={open}
        side="right"
        title="Conversation history"
      >
        <div className="chat-history">
          <IconButton
            className="chat-history__close"
            icon={<X size={18} weight="bold" />}
            label="Close conversation history"
            onClick={() => setOpen(false)}
            ref={closeButtonRef}
            size="sm"
            tone="quiet"
          />
          {conversations.length ? (
            <ul className="chat-history__list">
              {conversations.map((conversation) => (
                <li key={conversation.id}>
                  <Link href={`/app/conversations/${conversation.id}`}>
                    {conversation.character.displayName}
                    <span>{dateFormatter.format(conversation.archivedAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p>No archived conversations yet.</p>
          )}
        </div>
      </Drawer>
    </>
  );
}
