import { useTranslation } from "react-i18next";
import { Tags, X } from "lucide-react";
import type { AssetItem } from "../../types";
import { useAssetTagsMutation } from "../../tagsQueries";
import { errorMessage } from "../../i18n";
import { Badge, Tooltip } from "../ui";
import { TagPickerInput } from "../tags/TagPickerInput";
import { useToast } from "../shared/ToastProvider";

type Props = {
  asset: AssetItem;
};

export function AssetDrawerTags({ asset }: Props) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const mutation = useAssetTagsMutation();

  const aiTag = asset.aiTag;
  const hasAiTag = aiTag && aiTag.status === "ready";
  const currentTags = aiTag?.tags ?? [];

  function setTags(newTags: string[]) {
    mutation.mutate(
      {
        projectId: asset.projectId,
        repoPath: asset.repoPath,
        contentHash: asset.contentHash,
        hashAlgorithm: asset.hashAlgorithm,
        tags: newTags,
      },
      {
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  }

  function handleAdd(tag: string) {
    if (!currentTags.includes(tag)) {
      setTags([...currentTags, tag]);
    }
  }

  function handleRemove(tag: string) {
    setTags(currentTags.filter((t) => t !== tag));
  }

  const localeTags = aiTag?.tagsI18n?.[i18n.language];
  const displayTags =
    localeTags && localeTags.length > 0 ? localeTags : currentTags;

  return (
    <div className="flex flex-col gap-4">
      {hasAiTag && aiTag.category && (
        <div className="flex items-center gap-2">
          <span className="shrink-0 font-g text-g-caption font-[510] text-g-ink-3">
            {t("drawer.aiCategory")}
          </span>
          <Badge tone="purple">{aiTag.category}</Badge>
        </div>
      )}

      {currentTags.length > 0 ? (
        <div className="flex items-start gap-2">
          <Tags size={12} className="mt-1 shrink-0 text-g-ink-4" />
          <div className="flex flex-wrap gap-1">
            {currentTags.map((rawTag, idx) => {
              const display = displayTags[idx] ?? rawTag;
              const showTooltip = display !== rawTag;
              const badge = (
                <Badge
                  key={`${rawTag}-${idx}`}
                  tone="line"
                  className="gap-1 pr-1 text-g-ink-2"
                >
                  {display}
                  <button
                    type="button"
                    className="inline-flex items-center justify-center size-3.5 rounded-full hover:bg-g-surface-3 transition-colors cursor-pointer"
                    onClick={() => handleRemove(rawTag)}
                    aria-label={`${t("tags.removeTag")} ${rawTag}`}
                  >
                    <X size={9} />
                  </button>
                </Badge>
              );
              return showTooltip ? (
                <Tooltip
                  key={`${rawTag}-${idx}`}
                  label={rawTag}
                  placement="top"
                >
                  {badge}
                </Tooltip>
              ) : (
                badge
              );
            })}
          </div>
        </div>
      ) : (
        <p className="font-g text-g-caption text-g-ink-4">
          {t("tags.suggestEmpty")}
        </p>
      )}

      <TagPickerInput existingTags={currentTags} onAdd={handleAdd} />
    </div>
  );
}
