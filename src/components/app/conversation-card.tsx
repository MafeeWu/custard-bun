import { ArrowRight } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { Surface } from "@/components/ui/surface";

export interface ConversationCardProps {
  id: string;
  character: {
    displayName: string;
    avatarPath: string;
  };
}

export function ConversationCard({ character, id }: ConversationCardProps) {
  return (
    <Link
      aria-label={`Continue with ${character.displayName}`}
      className="application-conversation-card-link"
      href={`/app/conversations/${id}`}
    >
      <Surface
        as="article"
        className="application-conversation-card"
        padding="md"
        tone="default"
      >
        <div className="application-conversation-card__identity">
          <Avatar
            alt={`${character.displayName} avatar`}
            className="application-conversation-card__avatar"
            height={72}
            name={character.displayName}
            size="lg"
            src={character.avatarPath}
            width={72}
          />
          <div className="application-conversation-card__copy">
            <p className="application-conversation-card__eyebrow">
              Active conversation
            </p>
            <h3 className="application-conversation-card__title">
              {character.displayName}
            </h3>
            <p className="application-conversation-card__action">
              Continue with {character.displayName}
            </p>
          </div>
        </div>
        <span
          aria-hidden="true"
          className="application-conversation-card__direction"
        >
          <ArrowRight size={20} weight="bold" />
        </span>
      </Surface>
    </Link>
  );
}
