import Link from "next/link";
import type { MemoryRelationshipOverview } from "@/server/memory/memory-queries";

export function MemoryRelationshipOverview({
  relationships,
}: {
  relationships: MemoryRelationshipOverview[];
}) {
  return relationships.length ? (
    <ul className="memory-grid memory-overview">
      {relationships.map((row) => (
        <li key={row.character.id} className="memory-card">
          <h2>
            <Link href={`/app/memories/${row.character.id}`}>
              {row.character.displayName}
            </Link>
          </h2>
          <p>
            {row.itemCount} {row.itemCount === 1 ? "memory" : "memories"}
          </p>
          <p>
            {row.recordingEnabled ? "Recording on" : "Recording stopped"} ·{" "}
            {row.usageEnabled ? "Chat usage on" : "Chat usage stopped"}
          </p>
        </li>
      ))}
    </ul>
  ) : (
    <p>Start a conversation to manage a character’s memory here.</p>
  );
}
