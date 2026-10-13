import { BookOpenText, Brain, ChatCircleText } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import type { MemoryRelationshipOverview } from "@/server/memory/memory-queries";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Surface } from "@/components/ui/surface";

export function MemoryRelationshipOverview({
  relationships,
}: {
  relationships: MemoryRelationshipOverview[];
}) {
  if (!relationships.length) {
    return (
      <EmptyState
        className="memory-overview-empty"
        description="Start a conversation to manage a character’s memory here."
        title="No character memories yet"
      />
    );
  }

  return (
    <ul className="memory-grid memory-overview memory-overview-list">
      {relationships.map((row) => (
        <li key={row.character.id}>
          <Surface
            as="article"
            className="memory-card memory-overview-card"
            padding="lg"
            tone="subtle"
          >
            <div className="memory-overview-card__header">
              <div className="memory-overview-card__copy">
                <h3>
                  <Link href={`/app/memories/${row.character.id}`}>
                    {row.character.displayName}
                  </Link>
                </h3>
                <p className="memory-overview-card__count">
                  <BookOpenText aria-hidden="true" size={18} weight="bold" />
                  <span>
                    {row.itemCount}{" "}
                    {row.itemCount === 1 ? "memory" : "memories"}
                  </span>
                </p>
              </div>
              <LinkButton
                href={`/app/memories/${row.character.id}`}
                size="sm"
                tone="secondary"
              >
                Open controls
              </LinkButton>
            </div>
            <dl className="memory-overview-card__details">
              <div>
                <dt>
                  <Brain aria-hidden="true" size={18} weight="bold" />
                  <span>Recording</span>
                </dt>
                <dd>
                  {row.recordingEnabled
                    ? "Recording active"
                    : "Recording stopped"}
                </dd>
              </div>
              <div>
                <dt>
                  <ChatCircleText aria-hidden="true" size={18} weight="bold" />
                  <span>Recall</span>
                </dt>
                <dd>{row.usageEnabled ? "Recall active" : "Recall stopped"}</dd>
              </div>
            </dl>
          </Surface>
        </li>
      ))}
    </ul>
  );
}
