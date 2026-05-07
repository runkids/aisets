import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCatalogQuery } from "../queries";
import type { AssetItem } from "../types";
import { fileName, formatBytes } from "../ui";
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
  onOpenAsset?: (id: string) => void;
};

export function AssetDrawerSimilar({ asset, onOpenAsset }: Props) {
  const { t } = useTranslation();
  const catalogQuery = useCatalogQuery();
  const [selectedIdx, setSelectedIdx] = useState(0);

  const catalog = catalogQuery.data;
  const itemMap = useMemo(
    () => new Map(catalog?.items.map((i) => [i.id, i]) ?? []),
    [catalog?.items],
  );
  const pathToItem = useMemo(
    () => new Map(catalog?.items.map((i) => [i.repoPath, i]) ?? []),
    [catalog?.items],
  );

  const duplicateItems = useMemo(
    () =>
      asset.duplicates
        .map((path) => pathToItem.get(path))
        .filter((i): i is AssetItem => i != null && i.id !== asset.id),
    [asset.duplicates, asset.id, pathToItem],
  );

  const enriched = useMemo(() => {
    if (!catalog) return [];
    return asset.similar
      .map((id) => {
        const item = itemMap.get(id);
        if (!item) return null;
        const nd = catalog.nearDuplicates.find(
          (n) =>
            (n.leftId === asset.id && n.rightId === id) ||
            (n.rightId === asset.id && n.leftId === id),
        );
        const maxDistance = 64;
        const similarity = nd
          ? Math.round(((maxDistance - nd.distance) / maxDistance) * 100)
          : 0;
        return { id, item, similarity, mirrored: nd?.flipped ?? false };
      })
      .filter((x): x is EnrichedSimilar => x !== null);
  }, [asset.id, asset.similar, catalog, itemMap]);

  const selected = enriched[selectedIdx] ?? enriched[0];

  return (
    <div className="flex flex-col gap-5">
      {duplicateItems.length > 0 && (
        <div>
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-g-ink-4">
            {t("assetDrawer.exactDuplicates")}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {duplicateItems.map((dup) => (
              <button
                key={dup.id}
                type="button"
                onClick={() => onOpenAsset?.(dup.id)}
                className="cursor-pointer overflow-hidden rounded-g-md border border-g-line bg-g-surface-2 text-left transition-colors duration-[120ms] ease-g hover:border-g-line-strong hover:bg-g-surface-3"
              >
                <div className="flex aspect-[4/3] items-center justify-center bg-g-canvas p-3">
                  <img
                    src={dup.thumbnailUrl || dup.url}
                    alt={fileName(dup.repoPath)}
                    className="max-h-full max-w-full object-contain"
                  />
                </div>
                <div className="p-2">
                  <div className="truncate font-g-mono text-g-caption font-medium text-g-ink">
                    {fileName(dup.repoPath)}
                  </div>
                  <div className="truncate text-g-chip text-g-ink-3">
                    {dup.repoPath}
                  </div>
                  <div className="mt-1 text-g-chip text-g-ink-4">
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
            currentAsset={{
              thumbnailUrl: asset.thumbnailUrl || asset.url,
              url: asset.url,
              repoPath: asset.repoPath,
              bytes: asset.bytes,
              width: asset.image.width,
              height: asset.image.height,
              ext: asset.ext,
            }}
            similarAsset={{
              thumbnailUrl: selected.item.thumbnailUrl || selected.item.url,
              url: selected.item.url,
              repoPath: selected.item.repoPath,
              bytes: selected.item.bytes,
              width: selected.item.image.width,
              height: selected.item.image.height,
              ext: selected.item.ext,
            }}
            similarity={selected.similarity}
            mirrored={selected.mirrored}
          />

          {enriched.length >= 2 && (
            <div className="flex items-center gap-1.5 overflow-x-auto py-1">
              {enriched.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSelectedIdx(i)}
                  className={`shrink-0 cursor-pointer rounded-g-sm border-2 transition-colors duration-[120ms] ease-g ${
                    i === selectedIdx
                      ? "border-g-active-text"
                      : "border-transparent hover:border-g-line"
                  }`}
                  aria-label={s.item.repoPath}
                >
                  <AssetThumbnail
                    src={s.item.thumbnailUrl || s.item.url}
                    size="sm"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      ) : duplicateItems.length === 0 ? (
        <EmptyState title={t("assetDrawer.noSimilar")} />
      ) : null}
    </div>
  );
}
