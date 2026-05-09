import { AiChipIcon } from "./ui/AiChipIcon";
import type { AssetItem } from "../types";
import { Badge, Tooltip } from "./ui";

const MAX_VISIBLE_TAGS = 2;

export function AITagBadge({ item }: { item: AssetItem }) {
  if (!item.aiTag || item.aiTag.status !== "ready") return null;

  const category = item.aiTag.category;
  const tags = item.aiTag.tags ?? [];
  const visibleTags = tags.slice(0, MAX_VISIBLE_TAGS);
  const overflowCount = tags.length - MAX_VISIBLE_TAGS;
  const allTagsLabel = tags.join(", ");

  return (
    <>
      {category && (
        <Badge tone="purple">
          <AiChipIcon size={10} />
          {category}
        </Badge>
      )}
      {visibleTags.map((tag) => (
        <Badge key={tag} tone="line" className="text-g-ink-3">
          {tag}
        </Badge>
      ))}
      {overflowCount > 0 && (
        <Tooltip label={allTagsLabel} placement="top">
          <span className="inline-flex">
            <Badge tone="line" className="text-g-ink-4">
              +{overflowCount}
            </Badge>
          </span>
        </Tooltip>
      )}
    </>
  );
}
