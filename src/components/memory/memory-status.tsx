import {
  BookOpenText,
  Brain,
  ChatCircleText,
  Sparkle,
} from "@phosphor-icons/react/ssr";

export interface MemoryStatusProps {
  recordingEnabled: boolean;
  recallEnabled: boolean;
  activeItems: number;
  summaryPresent: boolean;
}

const statusItems = [
  {
    key: "recording",
    icon: Brain,
    label: "Recording",
  },
  {
    key: "recall",
    icon: ChatCircleText,
    label: "Recall",
  },
  {
    key: "items",
    icon: BookOpenText,
    label: "Saved memories",
  },
  {
    key: "summary",
    icon: Sparkle,
    label: "Summary",
  },
] as const;

export function MemoryStatus({
  activeItems,
  recallEnabled,
  recordingEnabled,
  summaryPresent,
}: MemoryStatusProps) {
  const values = {
    recording: recordingEnabled ? "Recording active" : "Recording stopped",
    recall: recallEnabled ? "Recall active" : "Recall stopped",
    items:
      activeItems === 1 ? "1 saved memory" : `${activeItems} saved memories`,
    summary: summaryPresent ? "Summary available" : "Summary not generated",
  } satisfies Record<(typeof statusItems)[number]["key"], string>;

  return (
    <dl className="memory-status">
      {statusItems.map(({ icon: Icon, key, label }) => (
        <div className="memory-status__item" key={key}>
          <dt className="memory-status__label">
            <Icon aria-hidden="true" size={18} weight="bold" />
            <span>{label}</span>
          </dt>
          <dd className="memory-status__value">{values[key]}</dd>
        </div>
      ))}
    </dl>
  );
}
