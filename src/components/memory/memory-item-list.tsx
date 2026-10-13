import type { RelationshipMemoryScreenView } from "@/server/memory/memory-queries";
import { MemoryItemForm } from "./memory-item-form";
import type { MemoryAction } from "./memory-form-state";

export function MemoryItemList({
  items,
  deleteAction,
  editAction,
}: {
  items: RelationshipMemoryScreenView["items"];
  deleteAction: MemoryAction;
  editAction: MemoryAction;
}) {
  if (!items.length) {
    return (
      <section className="memory-empty-state" aria-live="polite">
        <h3>No saved memories yet</h3>
        <p>
          Automatic memories appear here after new chats, and you can still keep
          this relationship memory-free whenever you want.
        </p>
      </section>
    );
  }

  return (
    <ul className="memory-grid memory-item-list">
      {items.map((item) => (
        <li key={item.id}>
          <MemoryItemForm
            deleteAction={deleteAction}
            editAction={editAction}
            item={item}
          />
        </li>
      ))}
    </ul>
  );
}
