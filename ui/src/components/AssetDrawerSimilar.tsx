import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { AssetItem, NearDuplicate } from "../types";
import { fileName, formatBytes } from "../ui";
import { toCompareAsset } from "./compareTypes";
import { SimilarCompare } from "./SimilarCompare";
import { AssetThumbnail, EmptyState } from "./ui";

type EnrichedSimilar = {
  id: string;
  item: AssetItem;
  similarity: number;
  mirrored: boolean;
};

type Props = {
  asset: AssetItem;
  duplicateItems: AssetItem[];
  similarItems: AssetItem[];
  nearDuplicates: NearDuplicate[];
  onOpenAsset?: (id: string) => void;
};

export function AssetDrawerSimilar({
  asset,
  duplicateItems,
  similarItems,
  nearDuplicates,
  onOpenAsset,
}: Props) {
  const { t } = useTranslation();
  const [selectedIdx, setSelectedIdx] = useState(0);

  const enriched = useMemo(() => {
    return similarItems
      .map((item) => {
        const nd = nearDuplicates.find(
          (n) =>
            (n.leftId === asset.id && n.rightId === item.id) ||
            (n.rightId === asset.id && n.leftId === item.id),
        );
        const maxDistance = 64;
        const similarity = nd
          ? Math.round(((maxDistance - nd.distance) / maxDistance) * 100)
          : 0;
        return {
          id: item.id,
          item,
          similarity,
          mirrored: nd?.flipped ?? false,
        };
      })
      .filter((x): x is EnrichedSimilar => x !== null);
  }, [asset.id, nearDuplicates, similarItems]);

  const selected = enriched[selectedIdx] ?? enriched[0];

  return (
    <div className="flex flex-col gap-5">
      {duplicateItems.length > 0 && (
        <div>
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-g-ink-4">
            {t("assetDrawer.exactDuplicates")}
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2">
            {duplicateItems.map((dup) => (
              <button
                key={dup.id}
                type="button"
                onClick={() => onOpenAsset?.(dup.id)}
                className="cursor-pointer overflow-hidden rounded-g-md border border-g-line bg-g-surface text-left transition-[border-color] duration-[120ms] ease-g hover:border-g-line-strong focus-visible:outline-none focus-visible:shadow-g-focus"
              >
                <AssetThumbnail
                  src={dup.thumbnailUrl || dup.url}
                  alt={fileName(dup.repoPath)}
                  size="fill"
                  className="rounded-none border-0 p-2"
                />
                <div className="px-2.5 py-2">
                  <div className="truncate font-g-mono text-g-caption text-g-ink">
                    {fileName(dup.repoPath)}
                  </div>
                  <div className="mt-px truncate font-g-mono text-[9px] text-g-ink-4">
                    {dup.repoPath}
                  </div>
                  <div className="mt-px font-g-mono text-[9px] text-g-ink-4">
                    {dup.image.width > 0 &&
                      `${dup.image.width}×${dup.image.height} · `}
                    {formatBytes(dup.bytes)} ·{" "}
                    {t("assetDrawer.refCount", {
                      count: dup.references.length,
                    })}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {enriched.length > 0 && selected ? (
        <div className="flex flex-col gap-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-g-ink-4">
            {t("assetDrawer.visualSimilar")}
          </div>

          <SimilarCompare
            currentAsset={toCompareAsset(asset)}
            similarAsset={toCompareAsset(selected.item)}
            similarity={selected.similarity}
            mirrored={selected.mirrored}
          />

          {enriched.length >= 2 && (
            <div className="flex items-center gap-2 rounded-g-md border border-g-line bg-g-surface-2 px-2 py-1.5">
              <button
                type="button"
                onClick={() =>
                  setSelectedIdx((i) => (i > 0 ? i - 1 : enriched.length - 1))
                }
                className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-g-sm text-g-ink-3 transition-colors duration-[120ms] ease-g hover:bg-g-surface hover:text-g-ink"
                aria-label="Previous"
              >
                <ChevronLeft size={16} />
              </button>
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <AssetThumbnail
                  src={selected.item.thumbnailUrl || selected.item.url}
                  size="sm"
                />
                <span className="truncate font-g-mono text-g-caption text-g-ink">
                  {fileName(selected.item.repoPath)}
                </span>
                <span className="shrink-0 font-g-mono text-g-caption text-g-ink-4">
                  {selectedIdx + 1}/{enriched.length}
                </span>
              </div>
              <button
                type="button"
                onClick={() =>
                  setSelectedIdx((i) => (i < enriched.length - 1 ? i + 1 : 0))
                }
                className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-g-sm text-g-ink-3 transition-colors duration-[120ms] ease-g hover:bg-g-surface hover:text-g-ink"
                aria-label="Next"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </div>
      ) : duplicateItems.length === 0 ? (
        <EmptyState title={t("assetDrawer.noSimilar")} />
      ) : null}
    </div>
  );
}
