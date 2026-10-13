import { Brain, Circle } from "@phosphor-icons/react/ssr";
import type { ReactNode } from "react";
import { Avatar } from "@/components/ui/avatar";
import { LinkButton } from "@/components/ui/button";
import type {
  ArchivedConversationSummary,
  UserConversationDetail,
} from "@/server/chat/conversation-queries";
import { ConversationHistory } from "./conversation-history";

export interface ChatHeaderProps {
  character: UserConversationDetail["character"];
  state: "available" | "replying" | "archived";
  memoryHref: string;
  history: ArchivedConversationSummary[];
  actions: ReactNode;
}

const stateLabels: Record<ChatHeaderProps["state"], string> = {
  archived: "Archived",
  available: "Available",
  replying: "Replying",
};

export function ChatHeader({
  actions,
  character,
  history,
  memoryHref,
  state,
}: ChatHeaderProps) {
  return (
    <header className="chat-header">
      <div className="chat-character">
        <Avatar
          alt=""
          className="chat-character__avatar"
          name={character.displayName}
          size="lg"
          src={character.avatarPath}
        />
        <div className="chat-character__copy">
          <p className="character-eyebrow">
            <Circle aria-hidden="true" size={10} weight="fill" />
            {stateLabels[state]}
          </p>
          <h1>{character.displayName}</h1>
        </div>
      </div>
      <div aria-label="Conversation tools" className="chat-header-actions">
        <LinkButton href={memoryHref} size="sm" tone="secondary">
          <Brain aria-hidden="true" size={18} weight="bold" />
          Manage memory
        </LinkButton>
        <ConversationHistory conversations={history} />
        {actions}
      </div>
    </header>
  );
}
